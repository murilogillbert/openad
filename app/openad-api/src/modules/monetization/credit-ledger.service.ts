import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';
import { centavosDoLancamento, restanteDaReserva } from './credit-cycle.policy';

/**
 * Saldo e débito do crédito de veiculação.
 *
 * Até aqui o `ad_credit_ledger` existia, append-only, bem modelado — e **nada escrevia nele**.
 * A campanha ia ao ar de graça e o motorista era creditado de verdade: a plataforma pagava o
 * motorista com dinheiro que nunca entrou.
 *
 * ============================================================================
 * O que é "saldo disponível"
 * ============================================================================
 *
 *     disponível = soma do ledger − parte não capturada das retenções abertas
 *
 * A parte **já capturada** de uma retenção não entra na subtração: ela virou débito no ledger,
 * então descontá-la outra vez contaria o mesmo gasto duas vezes, e o anunciante veria metade do
 * crédito desaparecer.
 */
@Injectable()
export class CreditLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CreditLedgerService.name);
  }

  /** Soma dos lançamentos, em micro-reais. */
  async saldoDoLedgerMicros(advertiserId: string): Promise<number> {
    const linhas = await this.prisma.adCreditLedger.findMany({
      where: { advertiserId },
      select: { direction: true, amountCents: true, amountMicros: true },
    });

    let saldo = 0;
    for (const l of linhas) {
      /**
       * `amountMicros` é a coluna exata e `amountCents` a projeção contábil. Lançamento
       * gravado antes de `amountMicros` existir só tem centavos, e aí a conversão é a melhor
       * verdade disponível. Preferir o micro quando ele existe evita perder o meio centavo de
       * cada imagem de 15 s.
       */
      const micros =
        l.amountMicros !== null && l.amountMicros !== undefined
          ? Number(l.amountMicros)
          : l.amountCents * 10_000;
      saldo += l.direction === 'credit' ? micros : -micros;
    }
    return saldo;
  }

  /** O que está retido e ainda não foi capturado, em micro-reais. */
  async retidoMicros(advertiserId: string): Promise<number> {
    const abertas = await this.prisma.adCreditHold.findMany({
      where: { advertiserId, status: 'open' },
      select: { amountMicros: true, capturedMicros: true },
    });
    return abertas.reduce((s, h) => s + restanteDaReserva(h), 0);
  }

  async saldoDisponivelMicros(advertiserId: string): Promise<number> {
    const [ledger, retido] = await Promise.all([
      this.saldoDoLedgerMicros(advertiserId),
      this.retidoMicros(advertiserId),
    ]);
    return ledger - retido;
  }

  /**
   * Debita a captura de uma veiculação. **Idempotente por `referenceId`.**
   *
   * Necessário porque Mongo e Postgres não compartilham transação: a veiculação vira faturável
   * de um lado e o débito acontece do outro. Repetir o débito — por reprocessamento de lote,
   * por retentativa, ou pelo job de conciliação — é inofensivo, exatamente como já é no
   * repasse ao motorista.
   *
   * O par `(débito no ledger, incremento da captura na retenção)` vai numa transação só. Sem
   * isso, uma falha no meio deixaria dinheiro debitado sem a retenção saber, e o fechamento do
   * ciclo devolveria ao saldo algo que já tinha sido gasto.
   *
   * Devolve `jaLancado: true` quando a referência já existia, para quem chama poder distinguir
   * "cobrei agora" de "já estava cobrado" no log.
   */
  async debitarCaptura(params: {
    advertiserId: string;
    campaignId: string;
    holdId: string | null;
    referenceId: string;
    amountMicros: number;
  }): Promise<{ jaLancado: boolean; lancado: boolean }> {
    const micros = Math.floor(params.amountMicros);
    if (micros <= 0) {
      // Veiculação sem custo é inventário institucional: não há o que debitar.
      return { jaLancado: false, lancado: false };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.adCreditLedger.create({
          data: {
            advertiserId: params.advertiserId,
            direction: 'debit',
            // A coluna fiscal arredonda para baixo; `amountMicros` guarda o exato, então nada
            // se perde entre as duas.
            amountCents: centavosDoLancamento(micros),
            amountMicros: BigInt(micros),
            reason: 'campaign_spend',
            campaignId: params.campaignId,
            referenceId: params.referenceId,
            holdId: params.holdId,
          },
        });

        if (params.holdId) {
          /**
           * O `CHECK` da tabela garante `captured_micros <= amount_micros`. Se a captura
           * estourar a reserva, a transação falha e o débito é desfeito — que é o
           * comportamento certo: capturar além do reservado é o defeito que a retenção existe
           * para impedir, e é melhor falhar alto do que gravar o estouro.
           */
          await tx.adCreditHold.update({
            where: { id: params.holdId },
            data: { capturedMicros: { increment: BigInt(micros) } },
          });
        }
      });
      return { jaLancado: false, lancado: true };
    } catch (e: unknown) {
      if (this.ehViolacaoDeUnicidade(e)) {
        // A referência já foi lançada. É o caminho esperado numa retentativa, não um erro.
        return { jaLancado: true, lancado: false };
      }
      throw e;
    }
  }

  /**
   * Lançamento manual de crédito pelo operador.
   *
   * Existe porque o plano prevê operar antes de haver compra automática: o crédito pode ser
   * lançado à mão no admin enquanto o provedor de pagamento está em `mock`. Sem isto, a
   * reserva por ciclo não teria o que reservar e nenhuma campanha veicularia.
   */
  async lancarAjuste(params: {
    advertiserId: string;
    amountMicros: number;
    direction: 'credit' | 'debit';
    referenceId: string;
    actorId: string | null;
    motivo: string;
  }): Promise<{ jaLancado: boolean }> {
    const micros = Math.floor(Math.abs(params.amountMicros));
    if (micros <= 0) {
      return { jaLancado: false };
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.adCreditLedger.create({
          data: {
            advertiserId: params.advertiserId,
            direction: params.direction,
            amountCents: centavosDoLancamento(micros),
            amountMicros: BigInt(micros),
            reason: 'adjustment',
            referenceId: params.referenceId,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: params.actorId,
            // Prefixo `openad.` é como a trilha compartilhada distingue qual serviço agiu.
            action: 'openad.credit.adjustment',
            entityType: 'AdCreditLedger',
            entityId: params.advertiserId,
            payloadJson: JSON.stringify({
              direction: params.direction,
              amountMicros: micros,
              referenceId: params.referenceId,
              motivo: params.motivo,
            }),
          },
        });
      });
      return { jaLancado: false };
    } catch (e: unknown) {
      if (this.ehViolacaoDeUnicidade(e)) {
        return { jaLancado: true };
      }
      throw e;
    }
  }

  /**
   * Credita uma compra confirmada. **Idempotente por `referenceId`.**
   *
   * Separado de `lancarAjuste` porque o motivo contábil é outro (`purchase`, não `adjustment`)
   * e porque o lançamento aponta para a compra — o extrato precisa poder dizer *qual* compra
   * gerou aquele crédito, e um ajuste genérico não responde isso.
   */
  async lancarCompra(params: {
    advertiserId: string;
    purchaseId: string;
    amountMicros: number;
    referenceId: string;
  }): Promise<{ jaLancado: boolean }> {
    const micros = Math.floor(params.amountMicros);
    if (micros <= 0) {
      return { jaLancado: false };
    }
    try {
      await this.prisma.adCreditLedger.create({
        data: {
          advertiserId: params.advertiserId,
          direction: 'credit',
          amountCents: centavosDoLancamento(micros),
          amountMicros: BigInt(micros),
          reason: 'purchase',
          purchaseId: params.purchaseId,
          referenceId: params.referenceId,
        },
      });
      return { jaLancado: false };
    } catch (e: unknown) {
      if (this.ehViolacaoDeUnicidade(e)) {
        // O mesmo pagamento confirmado duas vezes. É o caminho esperado quando o provedor
        // reenvia o evento, não um erro.
        return { jaLancado: true };
      }
      throw e;
    }
  }

  /**
   * Estorna uma compra com um **lançamento compensatório**, não apagando o original.
   *
   * O ledger é append-only e é registro fiscal: remover o crédito apagaria a prova de que ele
   * existiu, e o extrato passaria a não explicar o próprio saldo.
   *
   * O saldo pode ficar negativo, e isso é correto — o anunciante já gastou crédito que foi
   * devolvido. Negativo impede nova reserva e fica visível para cobrança ou ajuste, o que é
   * melhor do que zerar e perder a informação.
   */
  async lancarEstorno(params: {
    advertiserId: string;
    purchaseId: string;
    amountMicros: number;
    referenceId: string;
    motivo: string;
  }): Promise<{ jaLancado: boolean }> {
    const micros = Math.floor(params.amountMicros);
    if (micros <= 0) {
      return { jaLancado: false };
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.adCreditLedger.create({
          data: {
            advertiserId: params.advertiserId,
            direction: 'debit',
            amountCents: centavosDoLancamento(micros),
            amountMicros: BigInt(micros),
            reason: 'refund',
            purchaseId: params.purchaseId,
            referenceId: params.referenceId,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: 'openad.credit.refund',
            entityType: 'AdCreditPurchase',
            entityId: params.purchaseId,
            payloadJson: JSON.stringify({
              advertiserId: params.advertiserId,
              amountMicros: micros,
              motivo: params.motivo,
            }),
          },
        });
      });
      return { jaLancado: false };
    } catch (e: unknown) {
      if (this.ehViolacaoDeUnicidade(e)) {
        return { jaLancado: true };
      }
      throw e;
    }
  }

  /**
   * Violação de unicidade do Prisma (`P2002`).
   *
   * Comparar pelo código, e não pela mensagem: a mensagem muda entre versões e entre idiomas,
   * e um `catch` que depende dela passa a engolir erro de verdade no dia em que ela mudar.
   */
  private ehViolacaoDeUnicidade(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: unknown }).code === 'P2002'
    );
  }
}
