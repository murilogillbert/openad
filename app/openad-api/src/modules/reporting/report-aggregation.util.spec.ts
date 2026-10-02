import { aggregateByVehicle, sumBillable } from './report-aggregation.util';

describe('Report aggregation (US4)', () => {
  it('sums billable values', () => {
    expect(sumBillable([0.01, 0.02, 0.03])).toBeCloseTo(0.06);
  });

  it('aggregates by vehicle for totals', () => {
    const by = aggregateByVehicle([
      { vehicleId: 'v1', billingValue: 0.1 },
      { vehicleId: 'v1', billingValue: 0.1 },
      { vehicleId: 'v2', billingValue: 0.05 },
    ]);
    expect(by.v1.impressions).toBe(2);
    expect(by.v1.billableValue).toBeCloseTo(0.2);
    expect(by.v2.impressions).toBe(1);
    expect(by.v2.billableValue).toBeCloseTo(0.05);
  });
});
