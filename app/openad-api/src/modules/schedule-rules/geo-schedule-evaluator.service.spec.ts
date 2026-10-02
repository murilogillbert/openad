import {
  GeoScheduleEvaluatorService,
  pointInAnyZone,
  pointInPolygonRing,
  isTimeWindowActive,
  type ScheduleRuleEvalInput,
} from './geo-schedule-evaluator.service';

describe('GeoScheduleEvaluatorService', () => {
  const square: number[][][] = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ];

  it('pointInPolygonRing detects inside / outside', () => {
    expect(pointInPolygonRing(5, 5, square[0])).toBe(true);
    expect(pointInPolygonRing(50, 50, square[0])).toBe(false);
  });

  it('pointInAnyZone checks map of polygons', () => {
    const m = new Map<string, number[][][]>();
    m.set('z1', square);
    const rule: ScheduleRuleEvalInput = {
      ruleId: 'r1',
      priority: 1,
      assetId: 'a1',
      dwellThresholdSeconds: 0,
      geoZoneIds: ['z1'],
      zonePolygons: m,
      timeWindows: [],
    };
    expect(pointInAnyZone(5, 5, rule)).toBe(true);
    expect(pointInAnyZone(50, 5, rule)).toBe(false);
  });

  it('isTimeWindowActive respects weekday and clock', () => {
    const at = new Date('2026-04-06T08:00:00.000Z'); // Monday UTC
    const ok = isTimeWindowActive(at, [
      {
        daysOfWeek: ['MON'],
        startTime: '07:00',
        endTime: '10:00',
        timezone: 'UTC',
      },
    ]);
    expect(ok).toBe(true);
  });

  it('evaluate sorts by priority and applies dwell threshold', () => {
    const svc = new GeoScheduleEvaluatorService();
    const m = new Map<string, number[][][]>();
    m.set('z1', square);
    const rules: ScheduleRuleEvalInput[] = [
      {
        ruleId: 'low',
        priority: 5,
        assetId: 'a',
        dwellThresholdSeconds: 10,
        geoZoneIds: ['z1'],
        zonePolygons: m,
        timeWindows: [
          {
            daysOfWeek: ['MON'],
            startTime: '00:00',
            endTime: '23:59',
            timezone: 'UTC',
          },
        ],
      },
      {
        ruleId: 'high',
        priority: 1,
        assetId: 'b',
        dwellThresholdSeconds: 5,
        geoZoneIds: ['z1'],
        zonePolygons: m,
        timeWindows: [
          {
            daysOfWeek: ['MON'],
            startTime: '00:00',
            endTime: '23:59',
            timezone: 'UTC',
          },
        ],
      },
    ];
    const at = new Date('2026-04-06T12:00:00.000Z');
    const out = svc.evaluate(
      { lng: 5, lat: 5 },
      at,
      rules,
      { secondsInZone: 20 }
    );
    expect(out.map((r) => r.ruleId)).toEqual(['high', 'low']);
  });
});
