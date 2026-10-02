import { Injectable } from '@nestjs/common';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon as turfPolygon } from '@turf/helpers';
import type { DeviceStateDto } from '../dto/manifest-request.dto';

@Injectable()
export class ConstraintEvaluatorService {
  /** Returns true if the asset should be included for this device state. */
  assetMatches(
    constraints: Record<string, unknown> | undefined,
    state: DeviceStateDto | undefined
  ): boolean {
    if (!constraints || Object.keys(constraints).length === 0) {
      return true;
    }

    if (constraints.geofence) {
      if (state?.latitude === undefined || state?.longitude === undefined) {
        return false;
      }
    }
    if (constraints.speedRange && state?.speed === undefined) {
      return false;
    }

    /** Time windows use the hour in **UTC** (0–23), inclusive start, exclusive end. */
    if (constraints.timeWindows && Array.isArray(constraints.timeWindows)) {
      const ts = state?.timestamp ? new Date(state.timestamp) : new Date();
      const hour = ts.getUTCHours();
      const ok = (
        constraints.timeWindows as { startHour: number; endHour: number }[]
      ).some((tw) => hour >= tw.startHour && hour < tw.endHour);
      if (!ok) {
        return false;
      }
    }

    if (constraints.speedRange && state?.speed !== undefined) {
      const sr = constraints.speedRange as { minKmh: number; maxKmh: number };
      if (state.speed < sr.minKmh || state.speed > sr.maxKmh) {
        return false;
      }
    }

    if (
      constraints.geofence &&
      state?.latitude !== undefined &&
      state.longitude !== undefined
    ) {
      const g = constraints.geofence as {
        type: string;
        coordinates: number[][][];
      };
      if (g.type !== 'Polygon' || !g.coordinates?.[0]) {
        return false;
      }
      try {
        const poly = turfPolygon(g.coordinates);
        const pt = point([state.longitude, state.latitude]);
        if (!booleanPointInPolygon(pt, poly)) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }
}
