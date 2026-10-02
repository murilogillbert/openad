import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';

/** Rule slice used for evaluation (no Mongoose document). */
export interface ScheduleRuleEvalInput {
  ruleId: string;
  priority: number;
  assetId: string;
  dwellThresholdSeconds: number;
  geoZoneIds: string[];
  /** Outer ring lng/lat for each zone (aligned with geoZoneIds order). */
  zonePolygons: Map<string, number[][][]>;
  timeWindows: {
    daysOfWeek: string[];
    startTime: string;
    endTime: string;
    timezone: string;
  }[];
}

/** Luxon: Monday=1 … Sunday=7 */
const ISO_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Ray-cast point-in-polygon; ring is GeoJSON Polygon coordinates[0]. */
export function pointInPolygonRing(
  lng: number,
  lat: number,
  ring: number[][]
): boolean {
  if (ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInAnyZone(
  lng: number,
  lat: number,
  rule: ScheduleRuleEvalInput
): boolean {
  for (const zid of rule.geoZoneIds) {
    const coords = rule.zonePolygons.get(zid);
    if (!coords?.[0]) continue;
    if (pointInPolygonRing(lng, lat, coords[0])) return true;
  }
  return false;
}

export function isTimeWindowActive(
  at: Date,
  windows: ScheduleRuleEvalInput['timeWindows']
): boolean {
  for (const w of windows) {
    const dt = DateTime.fromJSDate(at).setZone(w.timezone);
    const dayKey = ISO_KEYS[dt.weekday - 1];
    const okDay = w.daysOfWeek.some(
      (d) => d.toUpperCase() === dayKey
    );
    if (!okDay) continue;

    const [sh, sm] = w.startTime.split(':').map(Number);
    const [eh, em] = w.endTime.split(':').map(Number);
    const start = dt.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
    let end = dt.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
    if (end <= start) {
      end = end.plus({ days: 1 });
    }
    if (dt >= start && dt <= end) return true;
  }
  return false;
}

@Injectable()
export class GeoScheduleEvaluatorService {
  /**
   * Returns rules that match geo + time + dwell, sorted by priority (lower number = higher priority).
   */
  evaluate(
    location: { lng: number; lat: number },
    at: Date,
    rules: ScheduleRuleEvalInput[],
    options?: { secondsInZone?: number }
  ): ScheduleRuleEvalInput[] {
    const dwell = options?.secondsInZone ?? 10_000;
    const matched: ScheduleRuleEvalInput[] = [];
    for (const r of rules) {
      if (!pointInAnyZone(location.lng, location.lat, r)) continue;
      if (!isTimeWindowActive(at, r.timeWindows)) continue;
      if (dwell < r.dwellThresholdSeconds) continue;
      matched.push(r);
    }
    matched.sort((a, b) => a.priority - b.priority);
    return matched;
  }

  /** True if two time windows overlap on a shared day (clock times, same-local comparison). */
  timeWindowsOverlap(
    a: { daysOfWeek: string[]; startTime: string; endTime: string },
    b: { daysOfWeek: string[]; startTime: string; endTime: string }
  ): boolean {
    const sharedDays = a.daysOfWeek.filter((d) =>
      b.daysOfWeek.map((x) => x.toUpperCase()).includes(d.toUpperCase())
    );
    if (sharedDays.length === 0) return false;
    const [a1, a2] = [a.startTime, a.endTime].map(parseHm);
    const [b1, b2] = [b.startTime, b.endTime].map(parseHm);
    return intervalsOverlapMinutes(a1, a2, b1, b2);
  }
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function intervalsOverlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  const ae = aEnd <= aStart ? aEnd + 24 * 60 : aEnd;
  const be = bEnd <= bStart ? bEnd + 24 * 60 : bEnd;
  return Math.max(aStart, bStart) < Math.min(ae, be);
}
