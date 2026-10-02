/** Pure mapping rules for impression ingestion (unit-tested). */

export function impressionLocationVerified(gpsLocked: boolean): boolean {
  return gpsLocked;
}

export function snapshotBillingValue(ratePerImpression: number): number {
  return ratePerImpression;
}
