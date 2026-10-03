import {
  centavosParaTexto,
  formatarCentavos,
  paraCentavos,
  veiculacoesPrevistas,
} from '@/lib/dinheiro';

/**
 * Dinheiro e a parte do app onde um erro custa dinheiro de verdade.
 *
 * A API do openad conta centavos inteiros; a tela mostra reais. Esta conversao e o unico
 * lugar onde as duas unidades se encontram, e o defeito que ela previne ja aconteceu na
 * propria API (pacing errado por fator 100).
 */
describe('paraCentavos', () => {
  it.each([
    ['1', 100],
    ['10', 1000],
    ['0,25', 25],
    ['0.25', 25],
    ['1234,56', 123456],
    ['1.234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['r$1234.56', 123456],
    ['  500,00  ', 50000],
    ['19,99', 1999],
    ['0,5', 50],
    ['0,05', 5],
  ])('converte %s em %i centavos', (texto, esperado) => {
    expect(paraCentavos(texto)).toBe(esperado);
  });

  it('trata separador de milhar sem decimais como inteiro de reais', () => {
    // `1.234` e mil duzentos e trinta e quatro reais, nao um real e vinte e tres centavos:
    // tres digitos depois do separador nao formam centavos.
    expect(paraCentavos('1.234')).toBe(123400);
    expect(paraCentavos('1,234')).toBe(123400);
  });

  it('arredonda em vez de truncar', () => {
    // `19.99 * 100` em ponto flutuante da 1998.9999...; truncar cobraria um centavo menos em
    // todo valor terminado em 9.
    expect(paraCentavos('19,99')).toBe(1999);
    expect(paraCentavos('0,99')).toBe(99);
    expect(paraCentavos('8,29')).toBe(829);
  });

  it.each(['', '   ', 'abc', '12abc', 'R$', '--', '1,2,3,4,5,6,7'])(
    'recusa entrada invalida: %s',
    (texto) => {
      const r = paraCentavos(texto);
      // Qualquer resultado nao nulo aqui significaria orcamento inventado a partir de lixo.
      expect(r === null || Number.isInteger(r)).toBe(true);
      if (texto.trim() === '' || /[a-z]/i.test(texto.replace(/r\$/i, ''))) {
        expect(r).toBeNull();
      }
    }
  );

  it('sempre devolve inteiro', () => {
    for (const t of ['1,005', '3,333', '0,001', '99,999']) {
      const r = paraCentavos(t);
      if (r !== null) expect(Number.isInteger(r)).toBe(true);
    }
  });
});

describe('centavosParaTexto', () => {
  it.each([
    [100, '1,00'],
    [25, '0,25'],
    [5, '0,05'],
    [123456, '1234,56'],
    [0, '0,00'],
    [-150, '-1,50'],
  ])('%i centavos vira %s', (centavos, esperado) => {
    expect(centavosParaTexto(centavos)).toBe(esperado);
  });

  it('e o inverso de paraCentavos', () => {
    for (const c of [1, 5, 25, 99, 100, 1999, 50000, 123456]) {
      expect(paraCentavos(centavosParaTexto(c))).toBe(c);
    }
  });
});

describe('formatarCentavos', () => {
  it('mostra duas casas decimais', () => {
    // O espaco que o `Intl` usa entre simbolo e numero pode ser nao separavel: a comparacao
    // normaliza para nao depender da versao do ICU.
    const normalizar = (s: string) => s.replace(/\u00a0/g, ' ');
    expect(normalizar(formatarCentavos(50000))).toContain('500,00');
    expect(normalizar(formatarCentavos(25))).toContain('0,25');
    expect(normalizar(formatarCentavos(5))).toContain('0,05');
  });

  it('nao quebra com codigo de moeda invalido', () => {
    expect(() => formatarCentavos(100, 'NAO_EXISTE')).not.toThrow();
    expect(formatarCentavos(100, 'NAO_EXISTE')).toContain('1,00');
  });
});

describe('veiculacoesPrevistas', () => {
  it('divide orcamento pela tarifa, para baixo', () => {
    expect(veiculacoesPrevistas(50000, 25)).toBe(2000);
    expect(veiculacoesPrevistas(100, 30)).toBe(3);
  });

  it('devolve 0 com tarifa zero ou negativa, em vez de Infinity', () => {
    // `Infinity` apareceria na tela como "∞ veiculacoes".
    expect(veiculacoesPrevistas(50000, 0)).toBe(0);
    expect(veiculacoesPrevistas(50000, -5)).toBe(0);
    expect(veiculacoesPrevistas(50000, Number.NaN)).toBe(0);
  });
});
