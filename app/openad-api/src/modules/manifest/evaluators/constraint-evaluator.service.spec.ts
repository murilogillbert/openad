import { ConstraintEvaluatorService } from './constraint-evaluator.service';

/** Small square around (0.5, 0.5) in lng/lat — point inside is (0.5, 0.5). */
const squareGeofence = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

describe('ConstraintEvaluatorService', () => {
  let svc: ConstraintEvaluatorService;

  beforeEach(() => {
    svc = new ConstraintEvaluatorService();
  });

  it('T106: includes asset when point is inside geofence polygon (turf)', () => {
    const ok = svc.assetMatches(
      { geofence: squareGeofence },
      {
        latitude: 0.5,
        longitude: 0.5,
        timestamp: new Date().toISOString(),
      }
    );
    expect(ok).toBe(true);
  });

  it('T106: excludes asset when point is outside geofence', () => {
    const ok = svc.assetMatches(
      { geofence: squareGeofence },
      {
        latitude: 2,
        longitude: 2,
        timestamp: new Date().toISOString(),
      }
    );
    expect(ok).toBe(false);
  });

  it('T106: excludes when geofence is set but device has no coordinates', () => {
    expect(
      svc.assetMatches({ geofence: squareGeofence }, { timestamp: new Date().toISOString() })
    ).toBe(false);
  });

  it('T114: UTC time window — hour 11 inside 10–12', () => {
    expect(
      svc.assetMatches(
        { timeWindows: [{ startHour: 10, endHour: 12 }] },
        { timestamp: '2020-01-01T11:00:00.000Z' }
      )
    ).toBe(true);
  });

  it('T114: UTC time window — hour 13 outside 10–12', () => {
    expect(
      svc.assetMatches(
        { timeWindows: [{ startHour: 10, endHour: 12 }] },
        { timestamp: '2020-01-01T13:00:00.000Z' }
      )
    ).toBe(false);
  });

  it('allows empty constraints', () => {
    expect(svc.assetMatches(undefined, undefined)).toBe(true);
    expect(svc.assetMatches({}, {})).toBe(true);
  });
});
