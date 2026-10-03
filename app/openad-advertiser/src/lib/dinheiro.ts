/**
 * Dinheiro em centavos inteiros, de ponta a ponta.
 *
 * A API do openad conta dinheiro em `Int` de centavos e só converte para decimal na fronteira
 * com o hub e com o opendriver. Este módulo é a fronteira do **app**: a tela mostra reais, o
 * servidor recebe centavos, e a conversão acontece em um lugar só.
 *
 * Isto não é zelo de tipagem. A conversão espalhada pelas telas foi exatamente o defeito
 * corrigido na API (pacing errado por fator 100), e lá o erro custou orçamento consumido cem
 * vezes mais rápido que o contratado.
 */

/** Centavos inteiros → `R$ 1.234,56`. */
export function formatarCentavos(centavos: number, moeda = 'BRL'): string {
  const valor = centavos / 100;
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: moeda,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(valor);
  } catch {
    // `Intl` com moeda inválida lança. O app não pode quebrar por causa de um código de moeda
    // estranho vindo do servidor.
    return `${moeda} ${valor.toFixed(2).replace('.', ',')}`;
  }
}

/**
 * Texto digitado pelo usuário → centavos inteiros, ou `null` se não é número válido.
 *
 * Aceita `1234,56`, `1234.56`, `R$ 1.234,56` e `1.234,56`. A regra para decidir qual
 * separador é o decimal: o **último** separador presente, quando seguido de 1 ou 2 dígitos.
 * `1.234` é mil duzentos e trinta e quatro; `1.23` é um e vinte e três.
 *
 * `Math.round` e não `Math.trunc`: `19.99 * 100` em ponto flutuante dá `1998.9999...`, e
 * truncar cobraria um centavo menos a cada valor terminado em 9 — invisível em um teste e
 * visível na conciliação do mês.
 */
export function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, '').replace(/^R\$?/i, '');
  if (!limpo) return null;
  if (!/^[\d.,]+$/.test(limpo)) return null;

  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');
  const posSeparador = Math.max(ultimaVirgula, ultimoPonto);

  let inteiros: string;
  let decimais: string;

  if (posSeparador === -1) {
    inteiros = limpo;
    decimais = '';
  } else {
    const depois = limpo.slice(posSeparador + 1);
    if (depois.length >= 1 && depois.length <= 2 && /^\d+$/.test(depois)) {
      inteiros = limpo.slice(0, posSeparador);
      decimais = depois;
    } else {
      // Separador de milhar: `1.234` ou `1,234`.
      inteiros = limpo;
      decimais = '';
    }
  }

  const soDigitosInteiros = inteiros.replace(/[.,]/g, '');
  if (soDigitosInteiros === '' && decimais === '') return null;
  if (!/^\d*$/.test(soDigitosInteiros)) return null;

  const reais = Number(soDigitosInteiros || '0');
  const frac = Number((decimais + '00').slice(0, 2));
  if (!Number.isFinite(reais) || !Number.isFinite(frac)) return null;

  return Math.round(reais * 100 + frac);
}

/** Centavos inteiros → texto para pré-preencher campo (`1234,56`, sem símbolo de moeda). */
export function centavosParaTexto(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Quantas veiculações o orçamento compra. `0` quando a tarifa é zero ou inválida — e não
 * `Infinity`, que apareceria na tela como "∞ veiculações".
 */
export function veiculacoesPrevistas(
  orcamentoCentavos: number,
  tarifaCentavos: number
): number {
  if (!Number.isFinite(tarifaCentavos) || tarifaCentavos <= 0) return 0;
  return Math.floor(orcamentoCentavos / tarifaCentavos);
}
