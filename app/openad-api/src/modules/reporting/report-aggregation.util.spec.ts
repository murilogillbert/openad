import {
  aggregateByVehicle,
  formatCentsAsAmount,
  sumBillableCents,
} from './report-aggregation.util';

describe('Report aggregation (US4)', () => {
  it('soma centavos sem erro de arredondamento', () => {
    // Em float, 0.01 + 0.02 + 0.03 nao e 0.06 — era por isso que o teste anterior precisava
    // de `toBeCloseTo`. Em centavos a igualdade e exata, e e isso que uma fatura exige.
    expect(sumBillableCents([1, 2, 3])).toBe(6);
  });

  it('soma exata mesmo em volume alto, onde o float divergiria', () => {
    // 100 mil veiculacoes a 7 centavos. Somando 0.07 em float o total erra na quarta casa;
    // somando inteiros o resultado e o unico possivel.
    const linhas = Array.from({ length: 100_000 }, () => 7);
    expect(sumBillableCents(linhas)).toBe(700_000);
  });

  it('aggregates by vehicle for totals', () => {
    const by = aggregateByVehicle([
      { vehicleId: 'v1', billingValueCents: 10 },
      { vehicleId: 'v1', billingValueCents: 10 },
      { vehicleId: 'v2', billingValueCents: 5 },
    ]);
    expect(by.v1.impressions).toBe(2);
    expect(by.v1.billableValueCents).toBe(20);
    expect(by.v2.impressions).toBe(1);
    expect(by.v2.billableValueCents).toBe(5);
  });

  describe('formatCentsAsAmount', () => {
    it('preenche a casa decimal faltante', () => {
      expect(formatCentsAsAmount(0)).toBe('0.00');
      expect(formatCentsAsAmount(5)).toBe('0.05');
      expect(formatCentsAsAmount(100)).toBe('1.00');
      expect(formatCentsAsAmount(1234)).toBe('12.34');
    });

    it('nao perde casa em valor grande', () => {
      // `(2147483647 / 100).toFixed(2)` devolve 21474836.47 por sorte, mas a divisao em float
      // deixa de ser confiavel acima disso. A divisao inteira nao tem esse limite pratico.
      expect(formatCentsAsAmount(2_147_483_647)).toBe('21474836.47');
      expect(formatCentsAsAmount(999_999_999_999)).toBe('9999999999.99');
    });

    it('trata valor negativo, que aparece em estorno', () => {
      expect(formatCentsAsAmount(-1)).toBe('-0.01');
      expect(formatCentsAsAmount(-1234)).toBe('-12.34');
    });
  });
});
