import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';
import { PixChargeClient } from './pix-charge.client';
import { MICROS_POR_CENTAVO, microsParaReais, tabelaDePreco } from './pricing.policy';

/**
 * Compra de crédito de veiculação por Pix, num painel web.
 *
 * ============================================================================
 * Por que não é compra dentro do app
 * ============================================================================
 *
 * A modelagem original previa in-app purchase, e a política do Google exige IAP para "bens
 * digitais consumidos dentro do app" — crédito de veiculação provavelmente se encaixa. Mas a
 * taxa é de 15 a 30%, e numa operação cujo preço unitário é R$ 0,045 por exibição isso sai do
 * que sobra para a plataforma e para o motorista.
 *
 * A decisão de 2026-10-07 foi comprar **fora do app**, num painel web, por Pix. Com isso a
 * validação de recibo de loja e os webhooks de estorno saem do escopo — eram os dois itens mais
 * pesados desta frente — e o app do anunciante fica só de gestão.
 *
 * ============================================================================
 * Valor mínimo
 * ============================================================================
 *
 * Existe um piso, e não é arbitrário: crédito que não cobre um ciclo de reserva produz uma
 * campanha que entra no ar e sai no ciclo seguinte. O anunciante pagaria para ver o anúncio
 * piscar.
 */
@Injectable()
export class CreditPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CreditLedgerService,
    private readonly pix: PixChargeClient,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CreditPurchaseService.name);
  }

  /** Piso de compra: R$ 20. Abaixo disso o Pix custa mais em atrito do que entrega em valor. */
  private static readonly MINIMO_CENTS = 2_000;
  /** Teto por cobrança, como barreira a erro de digitação: R$ 50.000. */
  private static readonly MAXIMO_CENTS = 5_000_000;

  /**
   * Saldo do anunciante, em três números que respondem perguntas diferentes.
   *
   * `disponivel` é o que pode ser reservado agora. `retido` é o que já está comprometido com
   * campanha no ar neste ciclo. `total` é a soma do livro-caixa. Mostrar só um deles levaria o
   * anunciante a concluir que o crédito desapareceu quando ele está, de fato, em uso.
   */
  async saldo(advertiserId: string) {
    const [totalMicros, retidoMicros] = await Promise.all([
      this.ledger.saldoDoLedgerMicros(advertiserId),
      this.ledger.retidoMicros(advertiserId),
    ]);
    const disponivelMicros = totalMicros - retidoMicros;

    return {
      totalMicros,
      retidoMicros,
      disponivelMicros,
      // Em reais, para a tela não precisar saber o que é micro-real.
      total: microsParaReais(totalMicros),
      retido: microsParaReais(retidoMicros),
      disponivel: microsParaReais(disponivelMicros),
      currency: 'BRL',
    };
  }

  /**
   * Extrato paginado do crédito.
   *
   * Em ordem decrescente de data, porque a pergunta que o anunciante faz é "para onde foi o
   * dinheiro", e a resposta começa no gasto mais recente.
   */
  async extrato(advertiserId: string, page = 1, limit = 50) {
    const take = Math.min(Math.max(Math.trunc(limit), 1), 200);
    const skip = (Math.max(Math.trunc(page), 1) - 1) * take;

    const [linhas, total] = await Promise.all([
      this.prisma.adCreditLedger.findMany({
        where: { advertiserId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          direction: true,
          reason: true,
          amountCents: true,
          amountMicros: true,
          campaignId: true,
          referenceId: true,
          createdAt: true,
        },
      }),
      this.prisma.adCreditLedger.count({ where: { advertiserId } }),
    ]);

    return {
      items: linhas.map((l) => {
        const micros =
          l.amountMicros !== null && l.amountMicros !== undefined
            ? Number(l.amountMicros)
            : l.amountCents * MICROS_POR_CENTAVO;
        return {
          id: l.id,
          direction: l.direction,
          reason: l.reason,
          amountMicros: micros,
          amount: microsParaReais(micros),
          campaignId: l.campaignId,
          referenceId: l.referenceId,
          createdAt: l.createdAt.toISOString(),
        };
      }),
      total,
      page: Math.max(Math.trunc(page), 1),
      limit: take,
    };
  }

  /**
   * Abre uma cobrança Pix para comprar crédito.
   *
   * A compra é gravada **antes** de pedir a cobrança ao hub, e não depois. A ordem importa: se
   * a cobrança fosse criada primeiro e a gravação falhasse, existiria um Pix no provedor sem
   * nada no nosso lado para reconhecê-lo — o anunciante pagaria e o crédito não entraria, e não
   * haveria registro para investigar. Gravando primeiro, o pior caso é uma compra `pending` sem
   * cobrança, que é visível e descartável.
   */
  async comprarComPix(params: {
    advertiserId: string;
    advertiserUserId: string;
    amountCents: number;
  }) {
    const valor = Math.trunc(params.amountCents);
    if (!Number.isFinite(valor) || valor < CreditPurchaseService.MINIMO_CENTS) {
      throw new BadRequestException({
        error: {
          code: 'AMOUNT_TOO_LOW',
          message: `O valor minimo de compra e R$ ${(CreditPurchaseService.MINIMO_CENTS / 100).toFixed(2)}.`,
        },
      });
    }
    if (valor > CreditPurchaseService.MAXIMO_CENTS) {
      throw new BadRequestException({
        error: {
          code: 'AMOUNT_TOO_HIGH',
          message: `O valor maximo por cobranca e R$ ${(CreditPurchaseService.MAXIMO_CENTS / 100).toFixed(2)}. Faca duas.`,
        },
      });
    }
    if (!this.pix.habilitado()) {
      /**
       * Configuração ausente é `503`, e não `500`: o pedido está correto e o serviço voltará a
       * funcionar quando a credencial existir. Um `500` sugeriria defeito de programa e mandaria
       * quem investiga para o lugar errado.
       */
      throw new ServiceUnavailableException({
        error: {
          code: 'PIX_NOT_CONFIGURED',
          message:
            'A cobranca por Pix ainda nao esta configurada. Fale com o suporte para lancar o credito manualmente.',
        },
      });
    }

    /**
     * Reaproveita cobrança pendente que ainda não venceu, em vez de criar outra.
     *
     * Sem isto, recarregar a página de pagamento criaria uma segunda cobrança para o mesmo
     * pedido, e o anunciante ficaria com duas pendentes — podendo pagar as duas.
     */
    const pendente = await this.prisma.adCreditPurchase.findFirst({
      where: {
        advertiserId: params.advertiserId,
        store: 'pix',
        receiptStatus: 'pending',
        priceCents: valor,
        pixExpiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (pendente?.pixCopyPaste) {
      return this.paraDto(pendente);
    }

    const purchaseId = randomUUID();
    const criada = await this.prisma.adCreditPurchase.create({
      data: {
        id: purchaseId,
        advertiserId: params.advertiserId,
        store: 'pix',
        // Sem SKU: em Pix o anunciante escolhe o valor.
        productSku: null,
        /**
         * Em Pix o crédito recebido é igual ao valor pago: não há taxa de loja a descontar. É a
         * economia que motivou sair do IAP, e fica explícita no dado.
         */
        creditCents: valor,
        priceCents: valor,
        storeFeeCents: 0,
        creditMicros: BigInt(valor * MICROS_POR_CENTAVO),
        // A chave natural da compra. No Pix é o próprio id, porque é ele que vai como
        // `reference` ao provedor e volta na confirmação.
        transactionId: purchaseId,
        requestedBy: params.advertiserUserId,
      },
    });

    try {
      const cobranca = await this.pix.criar({
        purchaseId,
        advertiserUserId: params.advertiserUserId,
        amountCents: valor,
        description: `Credito de veiculacao OpenAd — R$ ${(valor / 100).toFixed(2)}`,
      });

      const atualizada = await this.prisma.adCreditPurchase.update({
        where: { id: purchaseId },
        data: {
          chargeExternalId: cobranca.externalId,
          pixCopyPaste: cobranca.copyPaste,
          pixExpiresAt: cobranca.expiresAt ? new Date(cobranca.expiresAt) : null,
        },
      });

      this.logger.info({
        event: 'credito.pix.cobranca_criada',
        purchaseId,
        advertiserId: params.advertiserId,
        amountCents: valor,
      });
      return this.paraDto(atualizada);
    } catch (e: unknown) {
      /**
       * A cobrança falhou. A compra fica `pending` **sem** `charge_external_id`, e isso é
       * proposital: ela é o registro de que a tentativa existiu. Apagá-la aqui perderia o
       * rastro justamente no caso que precisa ser investigado.
       */
      this.logger.warn({
        event: 'credito.pix.cobranca_nao_criada',
        purchaseId,
        err: e instanceof Error ? e.message : String(e),
      });
      throw new ServiceUnavailableException({
        error: {
          code: 'PIX_CHARGE_FAILED',
          message: 'Nao foi possivel gerar a cobranca Pix agora. Tente de novo em alguns minutos.',
        },
      });
    }
  }

  /**
   * Confirma o pagamento e credita o ledger. **Idempotente.**
   *
   * Chamada pelo hub quando o Asaas confirma o pagamento. O hub **reconsulta o status no
   * Asaas** antes de chamar — ele nunca confia no corpo do webhook —, então o que chega aqui já
   * é um pagamento verificado.
   *
   * A idempotência é dupla, e as duas camadas servem a casos diferentes: `receiptStatus` já
   * `validated` faz a função retornar cedo, e o `referenceId` único no ledger protege contra
   * duas chamadas simultâneas que passem as duas pela primeira checagem.
   */
  async confirmarPagamento(params: {
    purchaseId: string;
    externalId: string | null;
  }): Promise<{ jaConfirmada: boolean; creditadoMicros: number }> {
    const compra = await this.prisma.adCreditPurchase.findUnique({
      where: { id: params.purchaseId },
    });
    if (!compra) {
      throw new NotFoundException({
        error: { code: 'PURCHASE_NOT_FOUND', message: 'Compra de credito nao encontrada.' },
      });
    }
    if (compra.receiptStatus === 'validated') {
      return { jaConfirmada: true, creditadoMicros: Number(compra.creditMicros ?? 0) };
    }
    if (compra.receiptStatus === 'refunded') {
      /**
       * Compra estornada que recebe confirmação é sinal de evento fora de ordem no provedor.
       * Creditar aqui devolveria dinheiro já devolvido; recusar deixa o caso visível.
       */
      throw new BadRequestException({
        error: {
          code: 'PURCHASE_REFUNDED',
          message: 'Esta compra foi estornada e nao pode ser confirmada.',
        },
      });
    }

    const micros = Number(
      compra.creditMicros ?? BigInt(compra.creditCents * MICROS_POR_CENTAVO)
    );

    const r = await this.ledger.lancarCompra({
      advertiserId: compra.advertiserId,
      purchaseId: compra.id,
      amountMicros: micros,
      // Única por compra: é o que impede o mesmo pagamento creditar duas vezes.
      referenceId: `purchase:${compra.id}`,
    });

    await this.prisma.adCreditPurchase.update({
      where: { id: compra.id },
      data: {
        receiptStatus: 'validated',
        validatedAt: new Date(),
        ...(params.externalId && !compra.chargeExternalId
          ? { chargeExternalId: params.externalId }
          : {}),
      },
    });

    this.logger.info({
      event: 'credito.pix.confirmado',
      purchaseId: compra.id,
      advertiserId: compra.advertiserId,
      creditadoMicros: micros,
      jaLancado: r.jaLancado,
    });
    return { jaConfirmada: r.jaLancado, creditadoMicros: micros };
  }

  /**
   * Estorno: lançamento compensatório, não apagamento.
   *
   * O ledger é append-only e é registro fiscal. Remover o crédito original apagaria a prova de
   * que ele existiu, e o extrato do anunciante passaria a não explicar o próprio saldo. O
   * estorno é um débito com `reason: 'refund'`.
   *
   * O saldo pode ficar **negativo** depois do estorno, e isso é correto: o anunciante já gastou
   * crédito que foi devolvido. Negativo impede nova reserva (nenhuma campanha veicula) e fica
   * visível para cobrança ou ajuste — melhor do que zerar e perder a informação.
   */
  async estornar(params: {
    purchaseId: string;
    motivo: string;
  }): Promise<{ jaEstornada: boolean; estornadoMicros: number }> {
    const compra = await this.prisma.adCreditPurchase.findUnique({
      where: { id: params.purchaseId },
    });
    if (!compra) {
      throw new NotFoundException({
        error: { code: 'PURCHASE_NOT_FOUND', message: 'Compra de credito nao encontrada.' },
      });
    }
    if (compra.receiptStatus === 'refunded') {
      return { jaEstornada: true, estornadoMicros: Number(compra.creditMicros ?? 0) };
    }
    if (compra.receiptStatus !== 'validated') {
      /**
       * Estornar o que nunca foi creditado não tem efeito no saldo, e lançar um débito criaria
       * um saldo negativo sem causa. Marcar como estornada basta.
       */
      await this.prisma.adCreditPurchase.update({
        where: { id: compra.id },
        data: { receiptStatus: 'refunded', refundedAt: new Date() },
      });
      return { jaEstornada: false, estornadoMicros: 0 };
    }

    const micros = Number(
      compra.creditMicros ?? BigInt(compra.creditCents * MICROS_POR_CENTAVO)
    );
    const r = await this.ledger.lancarEstorno({
      advertiserId: compra.advertiserId,
      purchaseId: compra.id,
      amountMicros: micros,
      referenceId: `refund:${compra.id}`,
      motivo: params.motivo,
    });

    await this.prisma.adCreditPurchase.update({
      where: { id: compra.id },
      data: { receiptStatus: 'refunded', refundedAt: new Date() },
    });

    this.logger.warn({
      event: 'credito.pix.estornado',
      purchaseId: compra.id,
      advertiserId: compra.advertiserId,
      estornadoMicros: micros,
      motivo: params.motivo,
    });
    return { jaEstornada: r.jaLancado, estornadoMicros: micros };
  }

  /**
   * Lançamento manual de crédito, feito pelo operador.
   *
   * É o que destrava a operação enquanto o Asaas não está configurado: o anunciante paga por
   * fora, o operador confere no extrato e lança o valor aqui. Sem este caminho, nenhuma
   * campanha veicularia até a credencial existir, porque a reserva por ciclo não teria o que
   * reservar.
   *
   * O `referenceId` é obrigatório e vem de quem chama — ver a nota no DTO. A conversão de
   * centavos para micro-reais fica aqui, e não no chamador, para a unidade do dinheiro ter um
   * único ponto de tradução.
   */
  async ajustar(params: {
    advertiserId: string;
    amountCents: number;
    direction: 'credit' | 'debit';
    referenceId: string;
    actorId: string | null;
    motivo: string;
  }): Promise<{ jaLancado: boolean; micros: number }> {
    const valor = Math.trunc(params.amountCents);
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new BadRequestException({
        error: {
          code: 'AMOUNT_INVALID',
          message: 'O valor do ajuste precisa ser um numero de centavos positivo.',
        },
      });
    }

    /**
     * Confere o anunciante antes de lançar.
     *
     * A chave estrangeira já recusaria o lançamento, mas como erro de banco — que sai como
     * `500` e manda quem investiga procurar defeito de programa. Um `advertiserId` digitado
     * errado no ajuste manual é o erro mais provável aqui, e merece resposta que o diga.
     */
    const existe = await this.prisma.adAdvertiser.findUnique({
      where: { id: params.advertiserId },
      select: { id: true },
    });
    if (!existe) {
      throw new NotFoundException({
        error: {
          code: 'ADVERTISER_NOT_FOUND',
          message: 'Anunciante nao encontrado no openad.',
        },
      });
    }

    const micros = valor * MICROS_POR_CENTAVO;
    const r = await this.ledger.lancarAjuste({
      advertiserId: params.advertiserId,
      amountMicros: micros,
      direction: params.direction,
      referenceId: params.referenceId,
      actorId: params.actorId,
      motivo: params.motivo,
    });

    this.logger.warn({
      event: 'credito.ajuste_manual',
      advertiserId: params.advertiserId,
      direction: params.direction,
      amountCents: valor,
      referenceId: params.referenceId,
      jaLancado: r.jaLancado,
    });
    return { jaLancado: r.jaLancado, micros };
  }

  /** Compras do anunciante, mais recentes primeiro. */
  async compras(advertiserId: string, page = 1, limit = 20) {
    const take = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const skip = (Math.max(Math.trunc(page), 1) - 1) * take;
    const [linhas, total] = await Promise.all([
      this.prisma.adCreditPurchase.findMany({
        where: { advertiserId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.adCreditPurchase.count({ where: { advertiserId } }),
    ]);
    return {
      items: linhas.map((l) => this.paraDto(l)),
      total,
      page: Math.max(Math.trunc(page), 1),
      limit: take,
    };
  }

  /** Tabela de preço e quanto cada valor de compra entrega, para a tela de compra. */
  tabela(pricePerSecondMicros: number) {
    return {
      pricePerSecondMicros,
      pricePerSecond: microsParaReais(pricePerSecondMicros),
      minimumCents: CreditPurchaseService.MINIMO_CENTS,
      maximumCents: CreditPurchaseService.MAXIMO_CENTS,
      byDuration: tabelaDePreco(pricePerSecondMicros).map((l) => ({
        seconds: l.segundos,
        costMicros: l.custoMicros,
        cost: l.custoReais,
      })),
    };
  }

  private paraDto(c: {
    id: string;
    store: string;
    receiptStatus: string;
    creditCents: number;
    priceCents: number;
    creditMicros: bigint | null;
    pixCopyPaste: string | null;
    pixExpiresAt: Date | null;
    chargeExternalId: string | null;
    createdAt: Date;
    validatedAt: Date | null;
    refundedAt: Date | null;
  }) {
    return {
      purchaseId: c.id,
      store: c.store,
      status: c.receiptStatus,
      amountCents: c.priceCents,
      amount: c.priceCents / 100,
      creditMicros: Number(c.creditMicros ?? c.creditCents * MICROS_POR_CENTAVO),
      pixCopyPaste: c.pixCopyPaste,
      pixExpiresAt: c.pixExpiresAt?.toISOString() ?? null,
      chargeExternalId: c.chargeExternalId,
      createdAt: c.createdAt.toISOString(),
      validatedAt: c.validatedAt?.toISOString() ?? null,
      refundedAt: c.refundedAt?.toISOString() ?? null,
    };
  }
}
