import {
  impressionLocationVerified,
  snapshotBillingValue,
} from './impression-mapping';

describe('impression mapping (US4)', () => {
  it('sets locationVerified from gpsLocked', () => {
    expect(impressionLocationVerified(true)).toBe(true);
    expect(impressionLocationVerified(false)).toBe(false);
  });

  it('snapshots billing from campaign ratePerImpression', () => {
    expect(snapshotBillingValue(0.05)).toBe(0.05);
  });
});
