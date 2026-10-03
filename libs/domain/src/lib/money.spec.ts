import { fromCents, toCents } from './money';

describe('money', () => {
  describe('toCents', () => {
    it('converte valores inteiros', () => {
      expect(toCents(0)).toBe(0);
      expect(toCents(1)).toBe(100);
      expect(toCents(1000)).toBe(100_000);
    });

    it('nao perde um centavo por erro de ponto flutuante', () => {
      // `0.07 * 100` vale 7.000000000000001; `Math.trunc` daria 6. Este e o teste que
      // justifica o `Math.round` da implementacao.
      expect(toCents(0.07)).toBe(7);
      expect(toCents(0.29)).toBe(29);
      expect(toCents(1.005)).toBe(101);
      expect(toCents(8.165)).toBe(817);
    });

    it('arredonda meio centavo para cima', () => {
      expect(toCents(0.005)).toBe(1);
    });

    it('recusa valor nao finito em vez de gravar NaN', () => {
      // Orcamento `NaN` no banco compara `false` com qualquer coisa: o pacing nunca pausaria
      // a campanha, e ela gastaria sem teto.
      expect(() => toCents(Number.NaN)).toThrow(TypeError);
      expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    });
  });

  describe('fromCents', () => {
    it('volta para a unidade maior', () => {
      expect(fromCents(0)).toBe(0);
      expect(fromCents(5)).toBe(0.05);
      expect(fromCents(100_000)).toBe(1000);
    });

    it('e inversa de toCents para valores de duas casas', () => {
      for (const valor of [0, 0.01, 0.07, 1, 12.34, 999.99, 1000]) {
        expect(fromCents(toCents(valor))).toBeCloseTo(valor, 10);
      }
    });
  });
});
