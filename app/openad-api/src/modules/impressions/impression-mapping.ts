/** Pure mapping rules for impression ingestion (unit-tested). */

export function impressionLocationVerified(gpsLocked: boolean): boolean {
  return gpsLocked;
}

/**
 * Congela o valor faturavel da veiculacao, em centavos inteiros.
 *
 * Parece identidade e nao e: existe para que o **momento** do congelamento seja explicito e
 * testavel. A tarifa da campanha pode mudar depois do evento, e a fatura ja emitida nao pode
 * mudar com ela.
 */
export function snapshotBillingValueCents(ratePerImpressionCents: number): number {
  return Math.max(0, Math.trunc(ratePerImpressionCents));
}
