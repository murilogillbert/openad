import { Injectable } from '@angular/core';
import type { ManifestMediaItem } from '../../sync/models/manifest-api.model';
import type { DeviceLocationSnapshot } from '../../../core/services/device-info.service';

/** Ray-cast point-in-polygon; ring is GeoJSON outer ring [lng, lat][]. */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  if (ring.length < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export interface DeviceConstraintState {
  latitude?: number;
  longitude?: number;
  speed?: number;
  timestamp?: string;
}

@Injectable()
export class ConstraintFilterService {
  /**
   * Per-asset manifest constraints were removed; campaign-level rules own targeting.
   * Playback uses the full manifest media list from the server.
   */
  filter(
    media: ManifestMediaItem[],
    state: DeviceConstraintState | null
  ): ManifestMediaItem[] {
    void state;
    return media;
  }

  snapshotFromLocation(loc: DeviceLocationSnapshot | null): DeviceConstraintState | null {
    if (!loc) {
      return null;
    }
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      speed: loc.speedKmh,
      timestamp: loc.timestamp,
    };
  }
}
