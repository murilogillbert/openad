import { PinoLogger } from 'nestjs-pino';
import { CreditLedgerService } from './credit-ledger.service';

/**
 * Saldo e débito do crédito de veiculação.
 *
 * Prisma falso de propósito: este projeto não tem testcontainers e o `DATABASE_URL` de teste é
 * fictício, com conexão preguiçosa. O que precisa de prova aqui é a **aritmética do saldo** e a
 * **idempotência do débito** — nenhuma das duas depende do Postgres estar de pé, e ambas são
 * dinheiro.
 */

type Lancamento = {
  direction: 'credit' | 'debit';
  amountCents: number;
  amountMicros: bigint | null;
};
type Reserva = { amountMicros: bigint; capturedMicros: bigint };

function construir(dados: {
  lancamentos?: Lancamento[];
  reservasAbertas?: Reserva[];
  /** Simula o único de `reference_id` já ocupado. */
  referenciasUsadas?: Set<string>;
}) {
  const referencias = dados.referenciasUsadas ?? new Set<string>();
  const criados: unknown[] = [];
  const holdsAtualizados: unknown[] = [];

  const erroDeUnicidade = () => {
    const e = new Error('Unique constraint failed') as Error & { code: string };
    e.code = 'P2002';
    return e;
  };

  const tx = {
    adCreditLedger: {
      create: jest.fn(async ({ data }: { data: { referenceId?: string | null } }) => {
        if (data.referenceId && referencias.has(data.referenceId)) {
          throw erroDeUnicidade();
        }
        if (data.referenceId) referencias.add(data.referenceId);
        criados.push(data);
        return data;
      }),
    },
    adCreditHold: {
      update: jest.fn(async (args: unknown) => {
        holdsAtualizados.push(args);
        return {};
      }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };

  const prisma = {
    adCreditLedger: {
      findMany: jest.fn(async () => dados.lancamentos ?? []),
    },
    adCreditHold: {
      findMany: jest.fn(async () => dados.reservasAbertas ?? []),
    },
    /**
     * `$transaction` com callback executa a função recebendo o cliente transacional. O falso
     * repassa `tx` e **propaga a exceção**, que é o comportamento que importa: é assim que a
     * violação de unicidade chega ao `catch` do serviço.
     */
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger;
  return {
    svc: new CreditLedgerService(prisma as never, logger),
    prisma,
    tx,
    criados,
    holdsAtualizados,
  };
}

const L = (
  direction: 'credit' | 'debit',
  micros: number | null,
  cents = 0
): Lancamento => ({
  direction,
  amountCents: cents,
  amountMicros: micros === null ? null : BigInt(micros),
});

const R = (amount: number, captured: number): Reserva => ({
  amountMicros: BigInt(amount),
  capturedMicros: BigInt(captured),
});

describe('saldoDoLedgerMicros', () => {
  it('soma credito e subtrai debito', () => {
    const { svc } = construir({
      lancamentos: [L('credit', 1_000_000), L('debit', 45_000), L('debit', 45_000)],
    });
    return expect(svc.saldoDoLedgerMicros('a')).resolves.toBe(910_000);
  });

  it('lancamento sem micro-reais cai nos centavos, que e a melhor verdade disponivel', async () => {
    /**
     * Lançamento gravado antes de `amount_micros` existir só tem centavos. Ignorá-lo zeraria o
     * saldo histórico do anunciante; convertê-lo é exato, porque centavo é múltiplo de
     * micro-real.
     */
    const { svc } = construir({ lancamentos: [L('credit', null, 500)] });
    await expect(svc.saldoDoLedgerMicros('a')).resolves.toBe(5_000_000);
  });

  it('prefere o micro-real quando ele existe', async () => {
    /**
     * Os dois convivem: `amount_cents` é a projeção contábil (arredondada para baixo) e
     * `amount_micros` é a verdade. Preferir o centavo perderia meio centavo de cada imagem de
     * 15 s.
     */
    const { svc } = construir({ lancamentos: [L('credit', 45_000, 4)] });
    await expect(svc.saldoDoLedgerMicros('a')).resolves.toBe(45_000);
  });

  it('ledger vazio da saldo zero', async () => {
    const { svc } = construir({});
    await expect(svc.saldoDoLedgerMicros('a')).resolves.toBe(0);
  });
});

describe('saldoDisponivelMicros', () => {
  it('desconta o que esta retido e nao capturado', async () => {
    const { svc } = construir({
      lancamentos: [L('credit', 1_000_000)],
      reservasAbertas: [R(450_000, 0)],
    });
    await expect(svc.saldoDisponivelMicros('a')).resolves.toBe(550_000);
  });

  it('a parte ja capturada da reserva nao e descontada duas vezes', async () => {
    /**
     * O erro que esta conta evita: a parte capturada **já virou débito no ledger**. Descontá-la
     * outra vez como "retida" contaria o mesmo gasto duas vezes, e o anunciante veria metade do
     * crédito desaparecer sem explicação.
     *
     * Crédito de R$ 1 (1.000.000 µR$), reserva de 450.000 com 450.000 capturados: o débito já
     * está no ledger, então o disponível é 550.000 — e não 100.000.
     */
    const { svc } = construir({
      lancamentos: [L('credit', 1_000_000), L('debit', 450_000)],
      reservasAbertas: [R(450_000, 450_000)],
    });
    await expect(svc.saldoDisponivelMicros('a')).resolves.toBe(550_000);
  });

  it('reserva parcialmente capturada retem so o restante', async () => {
    const { svc } = construir({
      lancamentos: [L('credit', 1_000_000), L('debit', 200_000)],
      reservasAbertas: [R(450_000, 200_000)],
    });
    // 1.000.000 − 200.000 (debitado) − 250.000 (restante retido) = 550.000
    await expect(svc.saldoDisponivelMicros('a')).resolves.toBe(550_000);
  });

  it('so consulta reservas abertas', async () => {
    const { svc, prisma } = construir({ lancamentos: [L('credit', 100)] });
    await svc.saldoDisponivelMicros('anunciante-1');
    expect(prisma.adCreditHold.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { advertiserId: 'anunciante-1', status: 'open' },
      })
    );
  });
});

describe('debitarCaptura', () => {
  const captura = {
    advertiserId: 'anunciante-1',
    campaignId: 'c-1',
    holdId: 'hold-1',
    referenceId: 'c-1:evento-1',
    amountMicros: 45_000,
  };

  it('lanca o debito e incrementa a captura da reserva, na mesma transacao', async () => {
    /**
     * As duas escritas juntas não são preciosismo: uma falha no meio deixaria dinheiro
     * debitado sem a reserva saber, e o fechamento do ciclo devolveria ao saldo algo que já
     * tinha sido gasto.
     */
    const { svc, criados, holdsAtualizados, prisma } = construir({});
    const r = await svc.debitarCaptura(captura);

    expect(r).toEqual({ jaLancado: false, lancado: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(criados).toHaveLength(1);
    expect(holdsAtualizados).toHaveLength(1);
  });

  it('grava centavos arredondados para baixo e o exato em micro-reais', async () => {
    // 45.000 µR$ são 4,5 centavos: a coluna fiscal recebe 4 e o exato fica em `amountMicros`.
    const { svc, criados } = construir({});
    await svc.debitarCaptura(captura);
    expect(criados[0]).toMatchObject({
      amountCents: 4,
      amountMicros: BigInt(45_000),
      direction: 'debit',
      reason: 'campaign_spend',
      referenceId: 'c-1:evento-1',
      holdId: 'hold-1',
    });
  });

  it('repetir o debito e inofensivo, e o chamador sabe que foi repetido', async () => {
    /**
     * A idempotência existe porque **Mongo e Postgres não compartilham transação**: a
     * veiculação vira faturável de um lado e o débito acontece do outro. Reprocessamento de
     * lote, retentativa e o job de conciliação chegam aqui com a mesma referência.
     */
    const usadas = new Set<string>();
    const { svc, criados } = construir({ referenciasUsadas: usadas });

    const primeira = await svc.debitarCaptura(captura);
    const segunda = await svc.debitarCaptura(captura);
    const terceira = await svc.debitarCaptura(captura);

    expect(primeira).toEqual({ jaLancado: false, lancado: true });
    expect(segunda).toEqual({ jaLancado: true, lancado: false });
    expect(terceira).toEqual({ jaLancado: true, lancado: false });
    // Um lançamento só, apesar das três tentativas.
    expect(criados).toHaveLength(1);
  });

  it('custo zero nao lanca nada', async () => {
    // Inventário institucional e filler tocam sem faturar: não há o que debitar.
    const { svc, criados, prisma } = construir({});
    const r = await svc.debitarCaptura({ ...captura, amountMicros: 0 });
    expect(r).toEqual({ jaLancado: false, lancado: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(criados).toHaveLength(0);
  });

  it('sem reserva, debita mas nao tenta incrementar captura', async () => {
    /**
     * Acontece quando a veiculação chega depois do fechamento do ciclo. O débito é registrado
     * para a conciliação não ficar procurando por ele, e não há reserva onde capturar.
     */
    const { svc, criados, holdsAtualizados } = construir({});
    await svc.debitarCaptura({ ...captura, holdId: null });
    expect(criados).toHaveLength(1);
    expect(holdsAtualizados).toHaveLength(0);
  });

  it('erro que nao e de unicidade sobe, em vez de ser engolido', async () => {
    /**
     * `catch` que trata qualquer exceção como "já lançado" esconderia falha de banco e o
     * débito nunca aconteceria, em silêncio. A comparação é pelo código `P2002`, e não pela
     * mensagem, porque a mensagem muda entre versões e idiomas.
     */
    const { svc, prisma } = construir({});
    prisma.$transaction.mockRejectedValueOnce(new Error('conexao caiu'));
    await expect(svc.debitarCaptura(captura)).rejects.toThrow('conexao caiu');
  });
});

describe('lancarAjuste', () => {
  it('credita a mao e registra na auditoria compartilhada', async () => {
    /**
     * Existe porque o plano prevê operar antes de haver compra automática: o crédito é lançado
     * à mão no admin enquanto o provedor de pagamento está em `mock`. Sem isto, a reserva por
     * ciclo não teria o que reservar e nenhuma campanha veicularia.
     */
    const { svc, criados, tx } = construir({});
    const r = await svc.lancarAjuste({
      advertiserId: 'anunciante-1',
      amountMicros: 5_000_000,
      direction: 'credit',
      referenceId: 'ajuste-1',
      actorId: 'operador-1',
      motivo: 'deposito por Pix conferido no extrato',
    });

    expect(r).toEqual({ jaLancado: false });
    expect(criados[0]).toMatchObject({
      direction: 'credit',
      reason: 'adjustment',
      amountCents: 500,
      amountMicros: BigInt(5_000_000),
    });
    // Prefixo `openad.` é como a trilha compartilhada distingue qual serviço agiu.
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'openad.credit.adjustment' }),
      })
    );
  });

  it('o mesmo ajuste nao e lancado duas vezes', async () => {
    const { svc, criados } = construir({});
    await svc.lancarAjuste({
      advertiserId: 'a',
      amountMicros: 1_000,
      direction: 'credit',
      referenceId: 'mesmo',
      actorId: null,
      motivo: 'x',
    });
    const segunda = await svc.lancarAjuste({
      advertiserId: 'a',
      amountMicros: 1_000,
      direction: 'credit',
      referenceId: 'mesmo',
      actorId: null,
      motivo: 'x',
    });
    expect(segunda).toEqual({ jaLancado: true });
    expect(criados).toHaveLength(1);
  });

  it('valor negativo e tratado pelo modulo, nao vira credito invertido', async () => {
    // `direction` decide o sinal; um valor negativo com `direction: 'credit'` criaria um
    // crédito que subtrai, que é indistinguível de um débito mal classificado.
    const { svc, criados } = construir({});
    await svc.lancarAjuste({
      advertiserId: 'a',
      amountMicros: -3_000,
      direction: 'debit',
      referenceId: 'neg',
      actorId: null,
      motivo: 'x',
    });
    expect(criados[0]).toMatchObject({ direction: 'debit', amountMicros: BigInt(3_000) });
  });
});
