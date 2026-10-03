/**
 * Conversao entre centavos inteiros e a unidade maior.
 *
 * Dentro do openad dinheiro e **sempre** centavo inteiro — e por isso que todo campo monetario
 * tem o sufixo `Cents` no nome. Estas duas funcoes existem para as duas unicas fronteiras onde
 * a unidade maior e legitima:
 *
 * 1. **Entrada humana.** Um operador digita `1000` querendo mil reais, nao dez reais. Forcar
 *    a digitacao em centavos troca um erro de unidade por outro.
 * 2. **Apresentacao.** Relatorio, PDF e tela mostram `R$ 1.000,00`.
 *
 * Toda conta — soma, pacing, faturamento, repasse — acontece em centavo. Nunca converta para
 * a unidade maior, calcule, e converta de volta: e exatamente esse ciclo que acumula erro.
 *
 * Nao vive em `libs/api-contracts` de proposito: nao e contrato de rota, e regra de dominio, e
 * o app do anunciante vai precisar dela tanto quanto o portal.
 */

/**
 * Converte um valor na unidade maior para centavos inteiros.
 *
 * O arredondamento e necessario e nao e preciosismo: `0.07 * 100` vale
 * `7.000000000000001` em IEEE 754, e `Math.trunc` disso daria **6**. Truncar um valor que o
 * usuario digitou como sete centavos para seis e erro de cobranca.
 *
 * `0.005` e meio centavo: arredonda para 1. A moeda nao tem terceira casa, entao recusar
 * seria mais honesto — mas essa recusa pertence a validacao do formulario, com mensagem para
 * o usuario, nao a uma funcao de conversao que nao tem como reclamar.
 *
 * @throws se o valor nao for finito. Silenciar `NaN` aqui produziria orcamento `NaN` no banco,
 *   que compara `false` com qualquer coisa e faria o pacing nunca pausar a campanha.
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`valor monetario invalido: ${String(amount)}`);
  }
  return Math.round(amount * 100);
}

/**
 * Converte centavos inteiros para a unidade maior, para exibicao.
 *
 * Devolve `number` porque o destino e um pipe de formatacao do Angular ou um
 * `Intl.NumberFormat`. Para gerar texto diretamente — CSV, PDF — prefira formatar a partir do
 * inteiro, sem passar por ponto flutuante.
 */
export function fromCents(cents: number): number {
  return Math.trunc(cents) / 100;
}
