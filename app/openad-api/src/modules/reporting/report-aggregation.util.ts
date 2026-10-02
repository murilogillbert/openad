/** Pure helpers for Proof-of-Play totals (unit-tested). */

export function sumBillable(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function uniqueZoneCountFromRuleIds(_ruleIds: string[]): number {
  return 0;
}

export function aggregateByVehicle(
  rows: { vehicleId: string; billingValue: number }[]
): Record<string, { impressions: number; billableValue: number }> {
  const byVehicle: Record<string, { impressions: number; billableValue: number }> =
    {};
  for (const r of rows) {
    const cur = byVehicle[r.vehicleId] ?? { impressions: 0, billableValue: 0 };
    cur.impressions += 1;
    cur.billableValue += r.billingValue;
    byVehicle[r.vehicleId] = cur;
  }
  return byVehicle;
}
