import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { MediaAsset } from '../media-ingestion/schemas/media-asset.schema';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import {
  decidirReservas,
  idDoCiclo,
  janelaDoCiclo,
  restanteDaReserva,
  type CampanhaParaReservar,
} from './credit-cycle.policy';
import {
  custoEmMicros,
  MICROS_POR_CENTAVO,
  segundosCobrados,
  tipoDoCriativo,
} from './pricing.policy';

export interface ResultadoDoCiclo {
  cycleId: string;
  opensAt: string;
  closesAt: string;
  anunciantesAvaliados: number;
  reservasAbertas: number;
  reservasReaproveitadas: number;
  campanhasSemReserva: number;
  totalReservadoMicros: number;
}

/**
 * Abre e fecha as reservas de crédito do ciclo.
 *
 * **É isto que faz "só vai ao ar o anúncio que tem crédito" ser verdade.** A elegibilidade
 * passa a exigir reserva aberta, e a reserva só existe se havia saldo no início do ciclo.
 *
 * Roda num job, numa instância só — ver o item G.4 do plano. Mas a correção não depende disso:
 * `cycleId` é determinístico e o índice único `(campaignId, cycleId)` faz a segunda tentativa
 * perder a escrita. Duas instâncias abrindo o ciclo ao mesmo tempo produzem as mesmas reservas,
 * não o dobro.
 */
@Injectable()
export class CreditCycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsRepository,
    @InjectModel(MediaAsset.name)
    private readonly mediaAssets: Model<MediaAsset>,
    private readonly platform: PlatformConfigRuntimeService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CreditCycleService.name);
  }

  /**
   * Custo de uma exibição da campanha, em micro-reais.
   *
   * Com preço por segundo, exibições da mesma campanha custam valores diferentes — uma imagem
   * de 15 s e um vídeo de 60 s não são a mesma coisa. Para dimensionar a reserva é preciso um
   * número só, e aqui ele é o **mais caro** entre os criativos anexados.
   *
   * O mais caro, e não a média, de propósito: a reserva é um compromisso de pagamento, e
   * subdimensioná-la faria a captura estourar o `CHECK` da tabela no meio do ciclo — a
   * veiculação aconteceria e o débito falharia. Superdimensionar apenas retém um pouco mais do
   * que o necessário, e o fechamento devolve a diferença.
   */
  private async custoMaisCaroMicros(campaignId: string): Promise<number> {
    const campanha = await this.campaigns.findByCampaignId(campaignId);
    if (!campanha) return 0;

    const monetizacao = this.platform.get().monetization;
    const preco = {
      modelo: campanha.budget?.pricingModel ?? 'per_impression',
      pricePerSecondMicros: campanha.budget?.pricePerSecondMicros ?? null,
      ratePerImpressionCents: campanha.budget?.ratePerImpressionCents ?? 0,
    } as const;

    if (preco.modelo === 'per_impression') {
      return custoEmMicros({
        preco,
        segundos: 0,
        pricePerSecondMicrosPadrao: monetizacao.pricePerSecondMicros,
      });
    }

    const criativos = await this.mediaAssets
      .find({ campaignId, isActive: true })
      .select({ duration: 1, mimeType: 1, filename: 1 })
      .lean()
      .exec();

    /**
     * Campanha sem criativo ativo é dimensionada pela imagem padrão.
     *
     * Ela não deveria estar ativa — a prontidão da campanha exige criativo —, mas se estiver,
     * reservar zero a deixaria fora do ar por um motivo que não é falta de crédito, e o
     * operador procuraria o problema no lugar errado.
     */
    if (!criativos.length) {
      return custoEmMicros({
        preco,
        segundos: monetizacao.imageDisplaySeconds,
        pricePerSecondMicrosPadrao: monetizacao.pricePerSecondMicros,
      });
    }

    let maior = 0;
    for (const c of criativos) {
      const segundos = segundosCobrados(
        { kind: tipoDoCriativo(c), durationSec: c.duration ?? null },
        monetizacao.imageDisplaySeconds
      );
      const custo = custoEmMicros({
        preco,
        segundos,
        pricePerSecondMicrosPadrao: monetizacao.pricePerSecondMicros,
      });
      if (custo > maior) maior = custo;
    }
    return maior;
  }

  /**
   * Abre as reservas do ciclo que contém `agora`.
   *
   * Uma transação por anunciante, com `SELECT … FOR UPDATE` na linha dele. O lock é no
   * anunciante, e não global, porque o que precisa ser serializado é a leitura do saldo
   * seguida da reserva **daquele** anunciante: dois anunciantes diferentes não disputam nada,
   * e um lock global transformaria a abertura do ciclo num gargalo que cresce com a base.
   */
  async abrirCiclo(agora: Date = new Date()): Promise<ResultadoDoCiclo> {
    const monetizacao = this.platform.get().monetization;
    const cycleId = idDoCiclo(agora, monetizacao.creditCycleMinutes);
    const { opensAt, closesAt } = janelaDoCiclo(agora, monetizacao.creditCycleMinutes);

    const ativas = await this.campaigns.findMany({
      status: 'active',
      scheduledStart: { $lte: agora },
      scheduledEnd: { $gte: agora },
    });

    /** Agrupa por anunciante: a reserva compete pelo saldo **dele**, não por um saldo global. */
    const porAnunciante = new Map<string, CampanhaParaReservar[]>();
    let semAnunciante = 0;
    for (const c of ativas) {
      if (!c.advertiserId) {
        /**
         * Campanha criada pelo operador, sem anunciante vinculado. Não tem crédito a reservar
         * e não é bloqueada por isso: é inventário institucional, e a elegibilidade a trata à
         * parte.
         */
        semAnunciante += 1;
        continue;
      }
      const custo = await this.custoMaisCaroMicros(c.campaignId);
      const lista = porAnunciante.get(c.advertiserId) ?? [];
      lista.push({
        campaignId: c.campaignId,
        priority: c.priority ?? 100,
        custoPorVeiculacaoMicros: custo,
        // O teto do ciclo é a fração do teto diário que cabe neste ciclo. Reservar além disso
        // prenderia dinheiro que o pacing não deixaria gastar hoje.
        tetoDoCicloMicros: this.tetoDoCicloMicros(c, monetizacao.creditCycleMinutes),
      });
      porAnunciante.set(c.advertiserId, lista);
    }

    let reservasAbertas = 0;
    let reservasReaproveitadas = 0;
    let campanhasSemReserva = 0;
    let totalReservadoMicros = 0;

    for (const [advertiserId, campanhas] of porAnunciante) {
      try {
        const r = await this.abrirParaAnunciante({
          advertiserId,
          campanhas,
          cycleId,
          opensAt,
          closesAt,
        });
        reservasAbertas += r.abertas;
        reservasReaproveitadas += r.reaproveitadas;
        campanhasSemReserva += r.semReserva;
        totalReservadoMicros += r.totalMicros;
      } catch (e: unknown) {
        /**
         * Falha de um anunciante não derruba o ciclo dos outros.
         *
         * O efeito de pular um anunciante é claro e limitado: as campanhas dele ficam sem
         * reserva e fora do manifesto deste ciclo, e o ciclo seguinte tenta de novo. Abortar
         * tudo tiraria a frota inteira do ar por causa de um registro.
         */
        this.logger.warn({
          event: 'credito.ciclo.anunciante_falhou',
          advertiserId,
          cycleId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const resultado: ResultadoDoCiclo = {
      cycleId,
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      anunciantesAvaliados: porAnunciante.size,
      reservasAbertas,
      reservasReaproveitadas,
      campanhasSemReserva,
      totalReservadoMicros,
    };
    this.logger.info({
      event: 'credito.ciclo.aberto',
      ...resultado,
      campanhasSemAnunciante: semAnunciante,
    });
    return resultado;
  }

  /**
   * Fração do teto diário que cabe num ciclo.
   *
   * Espelha `PacingSignalService.dailyBudgetCents`, de propósito: se este número fosse maior
   * que o do pacing, a reserva reteria dinheiro que o pacing pausaria antes de gastar.
   */
  private tetoDoCicloMicros(
    campanha: { budget?: { dailyBudgetCents?: number | null; totalAmountCents?: number } | null; scheduledStart?: Date; scheduledEnd?: Date },
    minutosPorCiclo: number
  ): number {
    const explicito = campanha.budget?.dailyBudgetCents ?? null;
    let diarioCents: number;
    if (explicito !== null && explicito > 0) {
      diarioCents = Math.floor(explicito);
    } else {
      const total = campanha.budget?.totalAmountCents ?? 0;
      const inicio = campanha.scheduledStart?.getTime?.() ?? Date.now();
      const fim = campanha.scheduledEnd?.getTime?.() ?? Date.now() + 86_400_000;
      const dias = Math.max(1, Math.ceil((fim - inicio) / 86_400_000));
      diarioCents = Math.max(1, Math.floor(total / dias));
    }
    const ciclosPorDia = Math.max(1, Math.floor(1440 / Math.max(1, minutosPorCiclo)));
    return Math.floor((diarioCents * MICROS_POR_CENTAVO) / ciclosPorDia);
  }

  private async abrirParaAnunciante(params: {
    advertiserId: string;
    campanhas: CampanhaParaReservar[];
    cycleId: string;
    opensAt: Date;
    closesAt: Date;
  }): Promise<{ abertas: number; reaproveitadas: number; semReserva: number; totalMicros: number }> {
    return this.prisma.$transaction(async (tx) => {
      /**
       * `FOR UPDATE` na linha do anunciante.
       *
       * Serializa a sequência "ler o saldo → abrir as reservas" para este anunciante. Sem o
       * lock, duas execuções simultâneas leriam o mesmo saldo e as duas reservariam — o índice
       * único impede a reserva duplicada da **mesma** campanha, mas não impediria reservar
       * para duas campanhas diferentes um dinheiro que só dá para uma.
       */
      await tx.$queryRaw`SELECT id FROM openad.ad_advertisers WHERE id = ${params.advertiserId}::uuid FOR UPDATE`;

      const [lancamentos, abertas, jaDoCiclo] = await Promise.all([
        tx.adCreditLedger.findMany({
          where: { advertiserId: params.advertiserId },
          select: { direction: true, amountCents: true, amountMicros: true },
        }),
        tx.adCreditHold.findMany({
          where: { advertiserId: params.advertiserId, status: 'open' },
          select: { amountMicros: true, capturedMicros: true },
        }),
        tx.adCreditHold.findMany({
          where: { cycleId: params.cycleId, advertiserId: params.advertiserId },
          select: { campaignId: true },
        }),
      ]);

      let saldo = 0;
      for (const l of lancamentos) {
        const micros =
          l.amountMicros !== null && l.amountMicros !== undefined
            ? Number(l.amountMicros)
            : l.amountCents * MICROS_POR_CENTAVO;
        saldo += l.direction === 'credit' ? micros : -micros;
      }
      const retido = abertas.reduce((s, h) => s + restanteDaReserva(h), 0);
      const disponivel = saldo - retido;

      /**
       * Campanha que já tem reserva neste ciclo é pulada, e não reaberta.
       *
       * É o que torna a execução repetida inofensiva: rodar o job duas vezes no mesmo ciclo
       * não reserva o dobro. A reserva existente já está contabilizada em `retido`, então o
       * saldo disponível aqui já desconta ela.
       */
      const jaReservadas = new Set(jaDoCiclo.map((h) => h.campaignId));
      const pendentes = params.campanhas.filter((c) => !jaReservadas.has(c.campaignId));

      const decisao = decidirReservas({
        saldoDisponivelMicros: disponivel,
        campanhas: pendentes,
      });

      for (const r of decisao.reservas) {
        await tx.adCreditHold.create({
          data: {
            advertiserId: params.advertiserId,
            campaignId: r.campaignId,
            cycleId: params.cycleId,
            amountMicros: BigInt(r.amountMicros),
            opensAt: params.opensAt,
            closesAt: params.closesAt,
          },
        });
      }

      return {
        abertas: decisao.reservas.length,
        reaproveitadas: jaReservadas.size,
        semReserva: decisao.semReserva.length,
        totalMicros: decisao.reservas.reduce((s, r) => s + r.amountMicros, 0),
      };
    });
  }

  /**
   * Fecha as reservas vencidas.
   *
   * O que não foi capturado volta ao saldo — não por um lançamento compensatório, mas por
   * deixar de contar como retido. É por isso que a retenção não vive no ledger: devolver
   * dinheiro que nunca saiu exigiria lançar uma saída e uma entrada para desfazer um
   * não-evento.
   *
   * `toleranciaMs` dá uma janela depois de `closesAt` antes de fechar: o tablet envia o lote de
   * veiculações com atraso, e fechar no segundo exato faria a captura chegar numa reserva já
   * fechada. Veiculação que chega depois da tolerância é absorvida pela plataforma — o
   * anunciante não é debitado por ela, porque o crédito já voltou para ele.
   */
  async fecharCiclosVencidos(params: {
    agora?: Date;
    toleranciaMs?: number;
  } = {}): Promise<{ fechadas: number; devolvidoMicros: number }> {
    const agora = params.agora ?? new Date();
    const tolerancia = params.toleranciaMs ?? 5 * 60_000;
    const limite = new Date(agora.getTime() - tolerancia);

    const vencidas = await this.prisma.adCreditHold.findMany({
      where: { status: 'open', closesAt: { lt: limite } },
      select: { id: true, amountMicros: true, capturedMicros: true, campaignId: true },
      take: 500,
    });

    let devolvido = 0;
    for (const h of vencidas) {
      devolvido += restanteDaReserva(h);
    }

    if (vencidas.length) {
      await this.prisma.adCreditHold.updateMany({
        where: { id: { in: vencidas.map((h) => h.id) } },
        data: { status: 'closed', closedAt: agora },
      });
    }

    this.logger.info({
      event: 'credito.ciclo.fechado',
      fechadas: vencidas.length,
      devolvidoMicros: devolvido,
    });
    return { fechadas: vencidas.length, devolvidoMicros: devolvido };
  }

  /** Reserva aberta da campanha no ciclo corrente, ou `null`. */
  async reservaAberta(
    campaignId: string,
    agora: Date = new Date()
  ): Promise<{ id: string; restanteMicros: number; playsRestantes: number; closesAt: Date } | null> {
    const monetizacao = this.platform.get().monetization;
    const cycleId = idDoCiclo(agora, monetizacao.creditCycleMinutes);
    const hold = await this.prisma.adCreditHold.findFirst({
      where: { campaignId, cycleId, status: 'open' },
      select: { id: true, amountMicros: true, capturedMicros: true, closesAt: true },
    });
    if (!hold) return null;

    const restante = restanteDaReserva(hold);
    const custo = await this.custoMaisCaroMicros(campaignId);
    return {
      id: hold.id,
      restanteMicros: restante,
      // A cota é calculada pelo criativo mais caro, igual à reserva: é o que garante que a
      // última exibição permitida ainda caiba no que resta.
      playsRestantes: custo > 0 ? Math.floor(restante / custo) : 0,
      closesAt: hold.closesAt,
    };
  }
}
