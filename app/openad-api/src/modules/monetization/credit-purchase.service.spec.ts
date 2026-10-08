import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CreditPurchaseService } from './credit-purchase.service';
import type { CreditLedgerService } from './credit-ledger.service';
import type { PixChargeClient } from './pix-charge.client';
import { MICROS_POR_CENTAVO } from './pricing.policy';

/**
 * Compra de crédito por Pix.
 *
 * Prisma falso, pela mesma razão do `credit-ledger.service.spec.ts`: o que precisa de prova
 * aqui é a **ordem das escritas**, a **idempotência** e o tratamento de configuração ausente.
 * Nenhuma das três depende do Postgres estar de pé, e todas são dinheiro.
 */

type Compra = {
  id: string;
  advertiserId: string;
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
};

function compraBase(over: Partial<Compra> = {}): Compra {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    advertiserId: '22222222-2222-4222-8222-222222222222',
    store: 'pix',
    receiptStatus: 'pending',
    creditCents: 90_000,
    priceCents: 90_000,
    creditMicros: BigInt(90_000 * MICROS_POR_CENTAVO),
    pixCopyPaste: null,
    pixExpiresAt: null,
    chargeExternalId: null,
    createdAt: new Date('2026-10-08T12:00:00.000Z'),
    validatedAt: null,
    refundedAt: null,
    ...over,
  };
}

function construir(dados: {
  pendente?: Compra | null;
  compra?: Compra | null;
  advertiserExiste?: boolean;
  pixHabilitado?: boolean;
  pixFalha?: boolean;
  jaLancado?: boolean;
} = {}) {
  /** Sequência das chamadas, para provar que a compra é gravada antes de pedir a cobrança. */
  const ordem: string[] = [];
  const criadas: Record<string, unknown>[] = [];
  const atualizacoes: Record<string, unknown>[] = [];

  const prisma = {
    adCreditPurchase: {
      findFirst: jest.fn(async () => dados.pendente ?? null),
      findUnique: jest.fn(async () =>
        dados.compra === undefined ? compraBase() : dados.compra
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ordem.push('create');
        criadas.push(data);
        return compraBase({ id: data.id as string, priceCents: data.priceCents as number });
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ordem.push('update');
        atualizacoes.push(data);
        return compraBase(data as Partial<Compra>);
      }),
      findMany: jest.fn(async () => [compraBase()]),
      count: jest.fn(async () => 1),
    },
    adCreditLedger: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    adAdvertiser: {
      findUnique: jest.fn(async () =>
        dados.advertiserExiste === false ? null : { id: 'adv' }
      ),
    },
  };

  const ledger = {
    saldoDoLedgerMicros: jest.fn(async () => 1_000_000),
    retidoMicros: jest.fn(async () => 300_000),
    lancarCompra: jest.fn(async () => ({ jaLancado: dados.jaLancado ?? false })),
    lancarEstorno: jest.fn(async () => ({ jaLancado: dados.jaLancado ?? false })),
    lancarAjuste: jest.fn(async () => ({ jaLancado: dados.jaLancado ?? false })),
  } as unknown as CreditLedgerService;

  const pix = {
    habilitado: jest.fn(() => dados.pixHabilitado !== false),
    criar: jest.fn(async () => {
      ordem.push('pix');
      if (dados.pixFalha) throw new Error('hub recusou');
      return {
        externalId: 'pay_123',
        copyPaste: '00020126...',
        expiresAt: '2026-10-09T12:00:00.000Z',
      };
    }),
  } as unknown as PixChargeClient;

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;

  return {
    svc: new CreditPurchaseService(prisma as never, ledger, pix, logger),
    prisma,
    ledger,
    pix,
    ordem,
    criadas,
    atualizacoes,
  };
}

describe('CreditPurchaseService.saldo', () => {
  it('separa total, retido e disponivel', async () => {
    const { svc } = construir();
    const s = await svc.saldo('adv');
    expect(s.totalMicros).toBe(1_000_000);
    expect(s.retidoMicros).toBe(300_000);
    // O disponível é o que pode ser reservado agora, e é o número que decide se a campanha vai
    // ao ar. Mostrar só o total faria o anunciante concluir que há crédito livre que não há.
    expect(s.disponivelMicros).toBe(700_000);
    expect(s.disponivel).toBeCloseTo(0.7, 6);
    expect(s.currency).toBe('BRL');
  });
});

describe('CreditPurchaseService.comprarComPix', () => {
  it('recusa valor abaixo do piso de R$ 20', async () => {
    const { svc, prisma } = construir();
    await expect(
      svc.comprarComPix({ advertiserId: 'a', advertiserUserId: 'u', amountCents: 1_999 })
    ).rejects.toBeInstanceOf(BadRequestException);
    // Recusa antes de qualquer escrita: crédito que não cobre um ciclo produziria campanha que
    // entra no ar e sai no ciclo seguinte.
    expect(prisma.adCreditPurchase.create).not.toHaveBeenCalled();
  });

  it('recusa valor acima do teto', async () => {
    const { svc } = construir();
    await expect(
      svc.comprarComPix({ advertiserId: 'a', advertiserUserId: 'u', amountCents: 5_000_001 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sem configuracao responde 503 e nao grava nada', async () => {
    const { svc, prisma } = construir({ pixHabilitado: false });
    /**
     * `503` e não `500`: o pedido está correto e o serviço volta a funcionar quando a
     * credencial existir. Um `500` mandaria quem investiga procurar defeito de programa.
     */
    await expect(
      svc.comprarComPix({ advertiserId: 'a', advertiserUserId: 'u', amountCents: 90_000 })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.adCreditPurchase.create).not.toHaveBeenCalled();
  });

  it('grava a compra antes de pedir a cobranca', async () => {
    const { svc, ordem } = construir();
    await svc.comprarComPix({
      advertiserId: 'a',
      advertiserUserId: 'u',
      amountCents: 90_000,
    });
    /**
     * A ordem é a garantia que importa. Na ordem inversa, uma falha de gravação deixaria um Pix
     * no provedor sem nada do nosso lado para reconhecê-lo: o anunciante pagaria, o crédito não
     * entraria, e não haveria registro para investigar.
     */
    expect(ordem).toEqual(['create', 'pix', 'update']);
  });

  it('em Pix o credito recebido e igual ao valor pago, sem taxa de loja', async () => {
    const { svc, criadas } = construir();
    await svc.comprarComPix({
      advertiserId: 'a',
      advertiserUserId: 'u',
      amountCents: 90_000,
    });
    const d = criadas[0];
    expect(d.store).toBe('pix');
    expect(d.creditCents).toBe(90_000);
    expect(d.priceCents).toBe(90_000);
    // Zero, e não 15 a 30%: é a economia que motivou sair do in-app purchase, e fica explícita
    // no dado em vez de só no comentário.
    expect(d.storeFeeCents).toBe(0);
    expect(d.creditMicros).toBe(BigInt(90_000 * MICROS_POR_CENTAVO));
    // Sem SKU: em Pix o anunciante escolhe o valor.
    expect(d.productSku).toBeNull();
    // `transaction_id` é a chave natural, e no Pix é o próprio id da compra — é ele que vai
    // como referência ao provedor e volta na confirmação.
    expect(d.transactionId).toBe(d.id);
  });

  it('reaproveita cobranca pendente nao vencida do mesmo valor', async () => {
    const pendente = compraBase({
      pixCopyPaste: '00020126ja-existe',
      pixExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      chargeExternalId: 'pay_antigo',
    });
    const { svc, prisma, pix } = construir({ pendente });
    const r = await svc.comprarComPix({
      advertiserId: 'a',
      advertiserUserId: 'u',
      amountCents: 90_000,
    });
    /**
     * Sem isto, recarregar a página de pagamento criaria uma segunda cobrança para o mesmo
     * pedido e o anunciante ficaria com duas pendentes — podendo pagar as duas.
     */
    expect(prisma.adCreditPurchase.create).not.toHaveBeenCalled();
    expect(pix.criar).not.toHaveBeenCalled();
    expect(r.pixCopyPaste).toBe('00020126ja-existe');
  });

  it('cobranca pendente sem copia-e-cola nao e reaproveitada', async () => {
    // É o resíduo de uma tentativa que falhou ao criar a cobrança. Devolvê-la daria ao
    // anunciante uma tela de pagamento sem código para pagar.
    const { svc, prisma, pix } = construir({ pendente: compraBase({ pixCopyPaste: null }) });
    await svc.comprarComPix({
      advertiserId: 'a',
      advertiserUserId: 'u',
      amountCents: 90_000,
    });
    expect(prisma.adCreditPurchase.create).toHaveBeenCalled();
    expect(pix.criar).toHaveBeenCalled();
  });

  it('falha do provedor deixa a compra gravada e responde 503', async () => {
    const { svc, prisma, ordem } = construir({ pixFalha: true });
    await expect(
      svc.comprarComPix({ advertiserId: 'a', advertiserUserId: 'u', amountCents: 90_000 })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    /**
     * A compra **não** é apagada. Ela é o registro de que a tentativa existiu; removê-la
     * perderia o rastro justamente no caso que precisa ser investigado.
     */
    expect(ordem).toEqual(['create', 'pix']);
    expect(prisma.adCreditPurchase.create).toHaveBeenCalled();
  });
});

describe('CreditPurchaseService.confirmarPagamento', () => {
  it('credita o ledger com referencia unica por compra', async () => {
    const { svc, ledger } = construir();
    const r = await svc.confirmarPagamento({ purchaseId: 'p', externalId: 'pay_1' });
    expect(ledger.lancarCompra).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMicros: 90_000 * MICROS_POR_CENTAVO,
        // É o que impede o mesmo pagamento creditar duas vezes quando o provedor reenvia.
        referenceId: 'purchase:11111111-1111-4111-8111-111111111111',
      })
    );
    expect(r.creditadoMicros).toBe(90_000 * MICROS_POR_CENTAVO);
  });

  it('compra ja validada retorna cedo sem lancar de novo', async () => {
    const { svc, ledger } = construir({
      compra: compraBase({ receiptStatus: 'validated' }),
    });
    const r = await svc.confirmarPagamento({ purchaseId: 'p', externalId: null });
    expect(r.jaConfirmada).toBe(true);
    expect(ledger.lancarCompra).not.toHaveBeenCalled();
  });

  it('propaga jaConfirmada quando a referencia ja existia no ledger', async () => {
    /**
     * Duas chamadas simultâneas podem passar as duas pela checagem de `receiptStatus`. O único
     * de `reference_id` é a segunda camada, e o serviço precisa reportá-la — senão o log diria
     * "cobrei agora" num caso em que não cobrou.
     */
    const { svc } = construir({ jaLancado: true });
    const r = await svc.confirmarPagamento({ purchaseId: 'p', externalId: null });
    expect(r.jaConfirmada).toBe(true);
  });

  it('compra estornada que recebe confirmacao e recusada', async () => {
    // Evento fora de ordem no provedor. Creditar aqui devolveria dinheiro já devolvido.
    const { svc } = construir({ compra: compraBase({ receiptStatus: 'refunded' }) });
    await expect(
      svc.confirmarPagamento({ purchaseId: 'p', externalId: null })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('compra inexistente e 404', async () => {
    const { svc } = construir({ compra: null });
    await expect(
      svc.confirmarPagamento({ purchaseId: 'p', externalId: null })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grava o externalId quando a compra nao tinha', async () => {
    const { svc, atualizacoes } = construir();
    await svc.confirmarPagamento({ purchaseId: 'p', externalId: 'pay_tardio' });
    expect(atualizacoes[0]).toMatchObject({
      receiptStatus: 'validated',
      chargeExternalId: 'pay_tardio',
    });
  });

  it('nao sobrescreve externalId existente', async () => {
    const { svc, atualizacoes } = construir({
      compra: compraBase({ chargeExternalId: 'pay_original' }),
    });
    await svc.confirmarPagamento({ purchaseId: 'p', externalId: 'pay_outro' });
    expect(atualizacoes[0]).not.toHaveProperty('chargeExternalId');
  });

  it('usa a conversao de centavos quando creditMicros e nulo', async () => {
    // Acervo: compras gravadas antes de `credit_micros` existir.
    const { svc, ledger } = construir({ compra: compraBase({ creditMicros: null }) });
    await svc.confirmarPagamento({ purchaseId: 'p', externalId: null });
    expect(ledger.lancarCompra).toHaveBeenCalledWith(
      expect.objectContaining({ amountMicros: 90_000 * MICROS_POR_CENTAVO })
    );
  });
});

describe('CreditPurchaseService.estornar', () => {
  it('lanca debito compensatorio e marca a compra', async () => {
    const { svc, ledger, atualizacoes } = construir({
      compra: compraBase({ receiptStatus: 'validated' }),
    });
    const r = await svc.estornar({ purchaseId: 'p', motivo: 'pagador contestou' });
    expect(ledger.lancarEstorno).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMicros: 90_000 * MICROS_POR_CENTAVO,
        referenceId: 'refund:11111111-1111-4111-8111-111111111111',
      })
    );
    expect(atualizacoes[0]).toMatchObject({ receiptStatus: 'refunded' });
    expect(r.estornadoMicros).toBe(90_000 * MICROS_POR_CENTAVO);
  });

  it('estorno repetido e idempotente', async () => {
    const { svc, ledger } = construir({ compra: compraBase({ receiptStatus: 'refunded' }) });
    const r = await svc.estornar({ purchaseId: 'p', motivo: 'x' });
    expect(r.jaEstornada).toBe(true);
    expect(ledger.lancarEstorno).not.toHaveBeenCalled();
  });

  it('compra pendente apenas vira refunded, sem debito', async () => {
    /**
     * Estornar o que nunca foi creditado não tem efeito no saldo, e lançar o débito criaria um
     * saldo negativo sem causa.
     */
    const { svc, ledger, atualizacoes } = construir({
      compra: compraBase({ receiptStatus: 'pending' }),
    });
    const r = await svc.estornar({ purchaseId: 'p', motivo: 'cobranca vencida' });
    expect(ledger.lancarEstorno).not.toHaveBeenCalled();
    expect(r.estornadoMicros).toBe(0);
    expect(atualizacoes[0]).toMatchObject({ receiptStatus: 'refunded' });
  });
});

describe('CreditPurchaseService.ajustar', () => {
  it('converte centavos em micro-reais e repassa a referencia', async () => {
    const { svc, ledger } = construir();
    await svc.ajustar({
      advertiserId: 'adv',
      amountCents: 50_000,
      direction: 'credit',
      referenceId: 'pix-extrato-001',
      actorId: null,
      motivo: 'deposito conferido',
    });
    expect(ledger.lancarAjuste).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMicros: 50_000 * MICROS_POR_CENTAVO,
        direction: 'credit',
        referenceId: 'pix-extrato-001',
      })
    );
  });

  it('anunciante inexistente e 404, nao erro de banco', async () => {
    /**
     * A chave estrangeira já recusaria, mas como erro de banco — `500`, e quem investiga
     * procurando defeito de programa. `advertiserId` digitado errado é o erro mais provável num
     * ajuste manual.
     */
    const { svc, ledger } = construir({ advertiserExiste: false });
    await expect(
      svc.ajustar({
        advertiserId: 'nao-existe',
        amountCents: 1_000,
        direction: 'credit',
        referenceId: 'r',
        actorId: null,
        motivo: 'm',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ledger.lancarAjuste).not.toHaveBeenCalled();
  });

  it('valor zero ou negativo e recusado', async () => {
    const { svc } = construir();
    for (const v of [0, -500]) {
      await expect(
        svc.ajustar({
          advertiserId: 'adv',
          amountCents: v,
          direction: 'credit',
          referenceId: 'r',
          actorId: null,
          motivo: 'm',
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('ajuste repetido com a mesma referencia nao credita duas vezes', async () => {
    const { svc } = construir({ jaLancado: true });
    const r = await svc.ajustar({
      advertiserId: 'adv',
      amountCents: 1_000,
      direction: 'credit',
      referenceId: 'duplo-clique',
      actorId: null,
      motivo: 'm',
    });
    expect(r.jaLancado).toBe(true);
  });
});

describe('CreditPurchaseService.extrato', () => {
  it('limita o tamanho da pagina', async () => {
    const { svc, prisma } = construir();
    await svc.extrato('adv', 1, 9_999);
    expect(prisma.adCreditLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 })
    );
  });

  it('pagina fora de faixa nao gera skip negativo', async () => {
    // `skip` negativo é erro de banco no Prisma, e chegaria como `500` numa consulta de leitura.
    const { svc, prisma } = construir();
    await svc.extrato('adv', 0, 50);
    expect(prisma.adCreditLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });
});

describe('CreditPurchaseService.tabela', () => {
  it('traz piso, teto e custo por duracao', async () => {
    const { svc } = construir();
    const t = svc.tabela(3_000);
    expect(t.minimumCents).toBe(2_000);
    expect(t.maximumCents).toBe(5_000_000);
    const quinze = t.byDuration.find((l) => l.seconds === 15);
    // R$ 0,003/s × 15 s = R$ 0,045. Em micro-reais, exato.
    expect(quinze?.costMicros).toBe(45_000);
  });
});
