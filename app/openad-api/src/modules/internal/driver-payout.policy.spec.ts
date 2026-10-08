import {
  boostDeRepasse,
  percentEfetivoDoRepasse,
  repasseEmCentavos,
} from './driver-payout.policy';

/**
 * A aritmética do pagamento ao motorista.
 *
 * Isto é o caminho do dinheiro: `repasseEmCentavos` é o valor creditado quando a veiculação
 * vira faturável, e `percentEfetivoDoRepasse` alimenta o peso do leilão, ou seja, decide
 * quanta entrega cada campanha ganha. Os dois ganharam o teto de 80%, e o que estes casos
 * travam é o comportamento nas bordas — que é onde regra de dinheiro erra.
 */
describe('repasseEmCentavos', () => {
  it('veiculacao que nao fatura nao reparte', () => {
    // Filler e inventário institucional tocam de graça: não há receita para repartir.
    expect(
      repasseEmCentavos({ valorFaturavelCents: 0, repasse: null, piso: 0.3 })
    ).toBe(0);
  });

  it('sem repasse declarado, paga o piso', () => {
    expect(
      repasseEmCentavos({ valorFaturavelCents: 100, repasse: null, piso: 0.3 })
    ).toBe(30);
  });

  it('arredonda para baixo, e a fracao fica com a plataforma', () => {
    /**
     * O contrário — arredondar para cima — criaria um passivo de fração de centavo
     * multiplicado por milhões de veiculações, pago com dinheiro que não foi faturado.
     */
    expect(
      repasseEmCentavos({ valorFaturavelCents: 7, repasse: null, piso: 0.3 })
    ).toBe(2); // 2,1 -> 2
  });

  it('limita ao teto, para a plataforma reter ao menos a diferenca', () => {
    // Campanha gravada antes do teto existir pode ter `percent` em qualquer valor até 100%, e
    // a validação de criação não reescreve o que já está no banco.
    expect(
      repasseEmCentavos({
        valorFaturavelCents: 100,
        repasse: { model: 'percent', percent: 1, valueCents: null },
        piso: 0.3,
        teto: 0.8,
      })
    ).toBe(80);
  });

  it('sem teto informado, mantem o comportamento anterior', () => {
    /**
     * O padrão 1 é deliberado: este é o caminho do faturamento, e uma configuração gravada
     * antes da chave existir não pode alterar quanto o motorista recebe.
     */
    expect(
      repasseEmCentavos({
        valorFaturavelCents: 100,
        repasse: { model: 'percent', percent: 1, valueCents: null },
        piso: 0.3,
      })
    ).toBe(100);
  });

  it('nunca paga mais do que o valor faturavel, mesmo com teto mal configurado', () => {
    // Limite econômico, independente da política: a plataforma não paga o que não recebeu.
    expect(
      repasseEmCentavos({
        valorFaturavelCents: 50,
        repasse: { model: 'per_play', percent: null, valueCents: 500 },
        piso: 0.3,
        teto: 2,
      })
    ).toBe(50);
  });

  it('teto abaixo do piso e configuracao errada, e o piso vence', () => {
    /**
     * Não há resposta certa aqui, então vale a menos surpreendente: o piso é a promessa feita
     * ao motorista, e pagar menos que o piso por causa de um teto mal digitado seria pior do
     * que exceder um teto impossível.
     */
    expect(
      repasseEmCentavos({
        valorFaturavelCents: 100,
        repasse: { model: 'percent', percent: 0.5, valueCents: null },
        piso: 0.3,
        teto: 0.1,
      })
    ).toBe(30);
  });

  it('per_play paga o valor fixo quando esta na faixa', () => {
    expect(
      repasseEmCentavos({
        valorFaturavelCents: 100,
        repasse: { model: 'per_play', percent: null, valueCents: 45 },
        piso: 0.3,
        teto: 0.8,
      })
    ).toBe(45);
  });

  it('per_play abaixo do piso e elevado ao piso', () => {
    // O piso é a promessa da plataforma, não do anunciante: vale mesmo contra a campanha.
    expect(
      repasseEmCentavos({
        valorFaturavelCents: 100,
        repasse: { model: 'per_play', percent: null, valueCents: 5 },
        piso: 0.3,
        teto: 0.8,
      })
    ).toBe(30);
  });
});

describe('percentEfetivoDoRepasse', () => {
  it('sem repasse, e o piso', () => {
    expect(percentEfetivoDoRepasse(null, 100, 0.3, 0.8)).toBe(0.3);
  });

  it('limita ao teto, para o leilao nao premiar repasse que o pagamento nao honra', () => {
    /**
     * Esta fração alimenta `boostDeRepasse`. Sem o limite, campanha com `percent: 1` gravada
     * antes do teto teria peso calculado sobre 100% e atropelaria as outras — comprando
     * entrega com um repasse que o pagamento já limita a 80%.
     */
    expect(
      percentEfetivoDoRepasse(
        { model: 'percent', percent: 1, valueCents: null },
        100,
        0.3,
        0.8
      )
    ).toBe(0.8);
  });

  it('per_play vira fracao pela tarifa', () => {
    expect(
      percentEfetivoDoRepasse(
        { model: 'per_play', percent: null, valueCents: 50 },
        100,
        0.3,
        0.8
      )
    ).toBe(0.5);
  });

  it('tarifa zero cai no piso em vez de dividir por zero', () => {
    // `Infinity` passaria pela comparação com o piso e gravaria um peso impossível.
    expect(
      percentEfetivoDoRepasse(
        { model: 'per_play', percent: null, valueCents: 50 },
        0,
        0.3,
        0.8
      )
    ).toBe(0.3);
  });

  it('sem teto informado, mantem o comportamento anterior', () => {
    expect(
      percentEfetivoDoRepasse(
        { model: 'percent', percent: 1, valueCents: null },
        100,
        0.3
      )
    ).toBe(1);
  });
});

describe('boostDeRepasse com a faixa de 30% a 80%', () => {
  it('campanha no piso tem peso neutro', () => {
    expect(boostDeRepasse({ percentEfetivo: 0.3, piso: 0.3, k: 0.5 })).toBe(1);
  });

  it('no teto, o peso maximo fica em ~1,83 e nunca encosta no limite de 3', () => {
    /**
     * Com piso 0,30, `k` 0,5 e teto 0,8: `1 + 0,5 × (0,8/0,3 − 1) ≈ 1,83`. O limite de 3 do
     * código deixa de ser alcançável, e vale saber disso: ele era a única coisa que impedia
     * dinheiro de atropelar relevância geográfica, e agora o teto chega antes.
     */
    const peso = boostDeRepasse({ percentEfetivo: 0.8, piso: 0.3, k: 0.5 });
    expect(peso).toBeCloseTo(1.8333, 3);
    expect(peso).toBeLessThan(3);
  });

  it('k igual a zero desliga o leilao', () => {
    // Saída segura se o comportamento em produção surpreender, sem exigir deploy.
    expect(boostDeRepasse({ percentEfetivo: 0.8, piso: 0.3, k: 0 })).toBe(1);
  });
});
