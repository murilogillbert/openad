/** Pure helpers for Proof-of-Play totals (unit-tested). Valores em centavos inteiros. */

export function sumBillableCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function uniqueZoneCountFromRuleIds(_ruleIds: string[]): number {
  return 0;
}

/**
 * Formata centavos inteiros como valor na unidade maior, com duas casas.
 *
 * Existe porque o CSV e o PDF de proof-of-play sao artefatos que o anunciante le: imprimir
 * `100` num campo rotulado `BRL` quando o valor e R$ 1,00 e erro de ordem de grandeza na cara
 * do cliente. A conversao acontece **so na apresentacao** — o total continua sendo somado em
 * inteiro.
 *
 * Nao usa divisao em ponto flutuante de proposito: `1 / 100` e representavel, mas
 * `(2_147_483_647 / 100).toFixed(2)` ja perde a ultima casa. Divisao inteira com resto e exata
 * para qualquer valor que caiba num `Number` seguro.
 */
export function formatCentsAsAmount(cents: number): string {
  const inteiro = Math.trunc(cents);
  const sinal = inteiro < 0 ? '-' : '';
  const absoluto = Math.abs(inteiro);
  const unidades = Math.floor(absoluto / 100);
  const resto = absoluto % 100;
  return `${sinal}${unidades}.${String(resto).padStart(2, '0')}`;
}

/**
 * Totaliza por veiculo, somando **inteiros**.
 *
 * Antes somava float (`billingValue`), o que acumulava erro de arredondamento proporcional ao
 * numero de veiculacoes — num numero que vai para a fatura do anunciante e para o repasse do
 * motorista.
 */
export function aggregateByVehicle(
  rows: { vehicleId: string; billingValueCents: number }[]
): Record<string, { impressions: number; billableValueCents: number }> {
  const byVehicle: Record<
    string,
    { impressions: number; billableValueCents: number }
  > = {};
  for (const r of rows) {
    const cur = byVehicle[r.vehicleId] ?? { impressions: 0, billableValueCents: 0 };
    cur.impressions += 1;
    cur.billableValueCents += r.billingValueCents;
    byVehicle[r.vehicleId] = cur;
  }
  return byVehicle;
}
