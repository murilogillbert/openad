import {
  deriveVehicleBindingStatus,
  effectiveLastSeen,
} from './vehicle-binding-status.util';

describe('deriveVehicleBindingStatus', () => {
  const now = new Date('2026-01-15T12:00:00.000Z');
  const fresh = new Date(now.getTime() - 30 * 60 * 1000);
  const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now.getTime());
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns in_shop when inShop', () => {
    expect(
      deriveVehicleBindingStatus({
        inShop: true,
        pairedDeviceIds: ['a'],
        lastSeenByDeviceId: new Map([['a', stale]]),
      })
    ).toBe('in_shop');
  });

  it('returns hardware_missing when no devices', () => {
    expect(
      deriveVehicleBindingStatus({
        inShop: false,
        pairedDeviceIds: [],
        lastSeenByDeviceId: new Map(),
      })
    ).toBe('hardware_missing');
  });

  it('returns hardware_offline when any last seen stale', () => {
    expect(
      deriveVehicleBindingStatus({
        inShop: false,
        pairedDeviceIds: ['a', 'b'],
        lastSeenByDeviceId: new Map([
          ['a', fresh],
          ['b', stale],
        ]),
      })
    ).toBe('hardware_offline');
  });

  it('returns fully_operational when all fresh', () => {
    expect(
      deriveVehicleBindingStatus({
        inShop: false,
        pairedDeviceIds: ['a'],
        lastSeenByDeviceId: new Map([['a', fresh]]),
      })
    ).toBe('fully_operational');
  });
});

describe('effectiveLastSeen', () => {
  it('prefers newer fleet report', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    const f = new Date('2026-01-02T00:00:00.000Z');
    expect(effectiveLastSeen(d, f)).toEqual(f);
  });
});
