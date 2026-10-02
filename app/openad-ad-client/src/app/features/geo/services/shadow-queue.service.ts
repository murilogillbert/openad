import { Injectable } from '@angular/core';
import type { SpatialEntryContract } from '@openad/api-contracts';

interface QueuedSpatial {
  entry: SpatialEntryContract;
}

/**
 * Holds spatial candidates deferred by loop-lock (non–Tier-1) and re-offers them after the
 * vehicle moves enough along its trajectory (005 US5).
 */
@Injectable({ providedIn: 'root' })
export class ShadowQueueService {
  private readonly queue: QueuedSpatial[] = [];
  /** First enqueue position — used to detect meaningful trajectory change. */
  private trajectoryAnchor: [number, number] | null = null;
  /** Default distance (m) before shadow entries are flushed for re-evaluation. */
  readonly defaultTrajectoryRefreshMeters = 35;

  enqueue(entry: SpatialEntryContract, lng: number, lat: number): void {
    if (this.queue.some((q) => q.entry.mediaId === entry.mediaId)) {
      return;
    }
    this.queue.push({ entry });
    if (this.trajectoryAnchor === null) {
      this.trajectoryAnchor = [lng, lat];
    }
  }

  /**
   * Call each GPS tick. When the vehicle has moved at least `minMeters` from the anchor,
   * drained entries should be re-evaluated by the geofence pipeline.
   */
  noteTrajectory(
    lng: number,
    lat: number,
    minMeters = this.defaultTrajectoryRefreshMeters
  ): SpatialEntryContract[] {
    if (this.queue.length === 0 || this.trajectoryAnchor === null) {
      return [];
    }
    const [aLng, aLat] = this.trajectoryAnchor;
    const moved = haversineMeters(aLng, aLat, lng, lat);
    if (moved < minMeters) {
      return [];
    }
    this.trajectoryAnchor = [lng, lat];
    return this.refreshAndDrain();
  }

  /** Returns queued entries and clears the queue (e.g. after a meaningful move). */
  refreshAndDrain(): SpatialEntryContract[] {
    const out = this.queue.map((q) => q.entry);
    this.queue.length = 0;
    this.trajectoryAnchor = null;
    return out;
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
    this.trajectoryAnchor = null;
  }
}

function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}
