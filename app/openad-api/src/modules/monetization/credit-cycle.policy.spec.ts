import {
  centavosDoLancamento,
  cotaPorTablet,
  decidirReservas,
  idDoCiclo,
  janelaDoCiclo,
  restanteDaReserva,
} from './credit-cycle.policy';

/**
 * Regras do ciclo de crédito.
 *
 * O que está sendo travado aqui é o que impede campanha de veicular sem crédito pago — hoje a
 * elegibilidade não consulta saldo nenhum, e o ledger existe sem nada escrevendo nele. Os
 * casos de borda importam mais que o caminho feliz: é neles que regra de dinheiro erra.
 */

const CICLO = 15;

describe('idDoCiclo', () => {
  it('arredonda para baixo pelo tamanho do ciclo', () => {
    expect(idDoCiclo(new Date('2026-10-08T15:37:42.123Z'), CICLO)).toBe('2026-10-08T15:30Z');
    expect(idDoCiclo(new Date('2026-10-08T15:30:00.000Z'), CICLO)).toBe('2026-10-08T15:30Z');
    expect(idDoCiclo(new Date('2026-10-08T15:44:59.999Z'), CICLO)).toBe('2026-10-08T15:30Z');
    expect(idDoCiclo(new Date('2026-10-08T15:45:00.000Z'), CICLO)).toBe('2026-10-08T15:45Z');
  });

  it('e deterministico, que e o que faz a abertura do ciclo ser idempotente', () => {
    /**
     * Duas instâncias da API que abram o ciclo no mesmo minuto calculam o mesmo valor, e o
     * índice único `(campaignId, cycleId)` faz uma delas perder a escrita. Um identificador
     * aleatório por execução reservaria o dobro com duas réplicas, e o defeito só apareceria
     * em produção.
     */
    const a = idDoCiclo(new Date('2026-10-08T15:31:00Z'), CICLO);
    const b = idDoCiclo(new Date('2026-10-08T15:39:00Z'), CICLO);
    expect(a).toBe(b);
  });

  it('respeita outros tamanhos de ciclo', () => {
    expect(idDoCiclo(new Date('2026-10-08T15:37:00Z'), 60)).toBe('2026-10-08T15:00Z');
    expect(idDoCiclo(new Date('2026-10-08T15:37:00Z'), 5)).toBe('2026-10-08T15:35Z');
  });

  it('ciclo zero ou negativo cai em um minuto, em vez de dividir por zero', () => {
    expect(idDoCiclo(new Date('2026-10-08T15:37:42Z'), 0)).toBe('2026-10-08T15:37Z');
    expect(idDoCiclo(new Date('2026-10-08T15:37:42Z'), -5)).toBe('2026-10-08T15:37Z');
  });
});

describe('janelaDoCiclo', () => {
  it('abre no inicio do ciclo e fecha no inicio do seguinte', () => {
    const j = janelaDoCiclo(new Date('2026-10-08T15:37:42Z'), CICLO);
    expect(j.opensAt.toISOString()).toBe('2026-10-08T15:30:00.000Z');
    expect(j.closesAt.toISOString()).toBe('2026-10-08T15:45:00.000Z');
  });
});

describe('decidirReservas', () => {
  const campanha = (
    campaignId: string,
    priority: number,
    custo: number,
    teto = Number.MAX_SAFE_INTEGER
  ) => ({
    campaignId,
    priority,
    custoPorVeiculacaoMicros: custo,
    tetoDoCicloMicros: teto,
  });

  it('reserva por prioridade, e nao proporcionalmente', () => {
    /**
     * Rateio proporcional daria a cada campanha uma fatia que pode não cobrir nem uma
     * exibição, e o anunciante veria todas no ar entregando quase nada. Com ordem de
     * prioridade, a mais importante veicula de verdade e a última fica de fora — visível e
     * corrigível.
     */
    const r = decidirReservas({
      saldoDisponivelMicros: 100_000, // R$ 0,10
      campanhas: [campanha('b', 2, 45_000), campanha('a', 1, 45_000)],
    });
    expect(r.reservas).toEqual([
      { campaignId: 'a', amountMicros: 90_000, playsNoCiclo: 2 },
    ]);
    expect(r.semReserva).toEqual([{ campaignId: 'b', motivo: 'sem_saldo' }]);
    expect(r.sobraMicros).toBe(10_000);
  });

  it('a reserva e multiplo inteiro do custo de uma exibicao', () => {
    /**
     * Reservar R$ 0,07 quando a exibição custa R$ 0,045 reteria R$ 0,025 que não podem virar
     * exibição nenhuma: dinheiro preso até o fim do ciclo, sem servir a ninguém.
     */
    const r = decidirReservas({
      saldoDisponivelMicros: 70_000,
      campanhas: [campanha('a', 1, 45_000)],
    });
    expect(r.reservas[0]).toEqual({ campaignId: 'a', amountMicros: 45_000, playsNoCiclo: 1 });
    expect(r.sobraMicros).toBe(25_000);
  });

  it('saldo que nao cobre uma exibicao nao reserva nada', () => {
    const r = decidirReservas({
      saldoDisponivelMicros: 44_999,
      campanhas: [campanha('a', 1, 45_000)],
    });
    expect(r.reservas).toEqual([]);
    expect(r.semReserva).toEqual([{ campaignId: 'a', motivo: 'sem_saldo' }]);
  });

  it('o teto do pacing limita a reserva', () => {
    /**
     * Reservar além do que o pacing diário deixaria gastar prenderia dinheiro até o fim do
     * ciclo, indisponível para outra campanha do mesmo anunciante.
     */
    const r = decidirReservas({
      saldoDisponivelMicros: 1_000_000,
      campanhas: [campanha('a', 1, 45_000, 100_000)],
    });
    expect(r.reservas[0]?.playsNoCiclo).toBe(2);
    expect(r.reservas[0]?.amountMicros).toBe(90_000);
    expect(r.sobraMicros).toBe(910_000);
  });

  it('campanha sem custo e inventario institucional, e fica fora da reserva', () => {
    // Toca sem faturar, então não precisa de reserva — e não deve ser bloqueada por falta dela.
    const r = decidirReservas({
      saldoDisponivelMicros: 1_000_000,
      campanhas: [campanha('institucional', 1, 0)],
    });
    expect(r.reservas).toEqual([]);
    expect(r.semReserva).toEqual([{ campaignId: 'institucional', motivo: 'sem_custo' }]);
    // O saldo continua inteiro: inventário sem custo não consome crédito.
    expect(r.sobraMicros).toBe(1_000_000);
  });

  it('teto zero fica de fora com motivo proprio', () => {
    const r = decidirReservas({
      saldoDisponivelMicros: 1_000_000,
      campanhas: [campanha('a', 1, 45_000, 0)],
    });
    expect(r.semReserva).toEqual([{ campaignId: 'a', motivo: 'teto_zero' }]);
  });

  it('saldo zero deixa todas sem reserva', () => {
    const r = decidirReservas({
      saldoDisponivelMicros: 0,
      campanhas: [campanha('a', 1, 45_000), campanha('b', 2, 30_000)],
    });
    expect(r.reservas).toEqual([]);
    expect(r.semReserva.map((s) => s.campaignId)).toEqual(['a', 'b']);
  });

  it('saldo negativo e tratado como zero', () => {
    // Não deveria acontecer, mas um ledger inconsistente não pode virar reserva negativa.
    const r = decidirReservas({
      saldoDisponivelMicros: -500_000,
      campanhas: [campanha('a', 1, 45_000)],
    });
    expect(r.reservas).toEqual([]);
    expect(r.sobraMicros).toBe(0);
  });

  it('empate de prioridade e resolvido pelo id, para a ordem ser estavel', () => {
    // Sem desempate, duas execuções com a mesma entrada poderiam reservar para campanhas
    // diferentes — e o anunciante veria a entrega trocar de lugar sem motivo.
    const r = decidirReservas({
      saldoDisponivelMicros: 45_000,
      campanhas: [campanha('zz', 1, 45_000), campanha('aa', 1, 45_000)],
    });
    expect(r.reservas[0]?.campaignId).toBe('aa');
  });
});

describe('cotaPorTablet', () => {
  it('divide com o resto para os primeiros, em vez de truncar', () => {
    /**
     * Truncar deixaria exibição reservada sem uso: 10 para 3 tablets daria 3 a cada um e
     * perderia 1. A reserva já foi feita, então a exibição perdida é dinheiro retido que não
     * vira entrega.
     */
    const c = cotaPorTablet({ playsNoCiclo: 10, deviceIds: ['a', 'b', 'c'] });
    expect([...c.values()]).toEqual([4, 3, 3]);
    expect([...c.values()].reduce((x, y) => x + y, 0)).toBe(10);
  });

  it('divisao exata distribui igual', () => {
    const c = cotaPorTablet({ playsNoCiclo: 9, deviceIds: ['a', 'b', 'c'] });
    expect([...c.values()]).toEqual([3, 3, 3]);
  });

  it('menos exibicoes que tablets deixa alguns com zero', () => {
    const c = cotaPorTablet({ playsNoCiclo: 2, deviceIds: ['a', 'b', 'c'] });
    expect([...c.values()]).toEqual([1, 1, 0]);
  });

  it('sem tablet, devolve vazio em vez de dividir por zero', () => {
    expect(cotaPorTablet({ playsNoCiclo: 10, deviceIds: [] }).size).toBe(0);
  });
});

describe('restanteDaReserva', () => {
  it('desconta o que ja foi capturado', () => {
    /**
     * A parte capturada já virou débito no ledger. Subtraí-la de novo no cálculo do saldo
     * contaria o mesmo gasto duas vezes, e o anunciante veria metade do crédito desaparecer.
     */
    expect(restanteDaReserva({ amountMicros: 90_000, capturedMicros: 45_000 })).toBe(45_000);
  });

  it('reserva inteiramente capturada nao retem nada', () => {
    expect(restanteDaReserva({ amountMicros: 90_000, capturedMicros: 90_000 })).toBe(0);
  });

  it('aceita BigInt, que e o que o Postgres devolve nas colunas de micro-reais', () => {
    /**
     * As colunas são `BIGINT` porque o teto do inteiro de 32 bits é ~R$ 2.147, e um anunciante
     * com R$ 3.000 de crédito estouraria. O Prisma devolve `bigint`, e aritmética direta entre
     * `bigint` e `number` lança `TypeError` — por isso a função converte antes de somar.
     *
     * `BigInt(...)` e não o literal `90_000n`: o projeto compila para antes do ES2020, e o
     * literal não existe nesse alvo.
     */
    expect(
      restanteDaReserva({ amountMicros: BigInt(90_000), capturedMicros: BigInt(45_000) })
    ).toBe(45_000);
  });

  it('nunca devolve negativo', () => {
    expect(restanteDaReserva({ amountMicros: 10, capturedMicros: 99 })).toBe(0);
  });
});

describe('centavosDoLancamento', () => {
  it('arredonda para baixo, e o exato fica na coluna de micro-reais', () => {
    // 4,5 centavos lançam 4; os 0,5 restantes continuam em `amount_micros`, que é a verdade.
    expect(centavosDoLancamento(45_000)).toBe(4);
    expect(centavosDoLancamento(10_000)).toBe(1);
    expect(centavosDoLancamento(9_999)).toBe(0);
  });

  it('negativo vira zero', () => {
    expect(centavosDoLancamento(-5_000)).toBe(0);
  });
});
