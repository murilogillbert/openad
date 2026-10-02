import { Injectable, signal } from '@angular/core';

export interface LocationPipelineConfig {
  /** EMA factor for new fixes (0–1); higher = less smoothing. */
  smoothingAlpha: number;
  minPollIntervalMs: number;
  maxPollIntervalMs: number;
  /** After this many ms without a fresh fix, {@link positionForEvaluation} may extrapolate. */
  deadReckoningTimeoutMs: number;
}

const DEFAULT_CONFIG: LocationPipelineConfig = {
  smoothingAlpha: 0.35,
  minPollIntervalMs: 2_000,
  maxPollIntervalMs: 30_000,
  deadReckoningTimeoutMs: 15_000,
};

/**
 * GPS smoothing, adaptive suggested poll interval, and optional dead reckoning when fixes go stale (005 US3).
 */
@Injectable({ providedIn: 'root' })
export class LocationPipelineService {
  readonly lastSmoothed = signal<{ lng: number; lat: number } | null>(null);
  readonly lastDeadReckoned = signal(false);

  private cfg: LocationPipelineConfig = DEFAULT_CONFIG;
  private prevSmoothedLng: number | null = null;
  private prevSmoothedLat: number | null = null;
  private lastFixMs = 0;
  private lastRawLng: number | null = null;
  private lastRawLat: number | null = null;
  /** Ground speed in m/s from last fix. */
  private lastSpeedMs = 0;
  private lastBearingRad: number | null = null;

  /** @internal testing */
  _setConfig(partial: Partial<LocationPipelineConfig>): void {
    this.cfg = { ...this.cfg, ...partial };
  }

  reset(): void {
    this.prevSmoothedLng = null;
    this.prevSmoothedLat = null;
    this.lastFixMs = 0;
    this.lastRawLng = null;
    this.lastRawLat = null;
    this.lastSpeedMs = 0;
    this.lastBearingRad = null;
    this.lastSmoothed.set(null);
    this.lastDeadReckoned.set(false);
  }

  /**
   * Ingest a GPS fix. Updates internal smoothed state and returns the filtered coordinate.
   */
  processRaw(
    lng: number,
    lat: number,
    nowMs: number,
    opts?: { speedKmh?: number }
  ): {
    lng: number;
    lat: number;
    suggestedNextPollMs: number;
    isDeadReckoned: boolean;
  } {
    const speedKmh = opts?.speedKmh;
    this.lastSpeedMs = speedKmh != null && !Number.isNaN(speedKmh) ? speedKmh / 3.6 : 0;

    if (this.lastRawLng != null && this.lastRawLat != null) {
      this.lastBearingRad = bearingRad(
        this.lastRawLng,
        this.lastRawLat,
        lng,
        lat
      );
    }
    this.lastRawLng = lng;
    this.lastRawLat = lat;
    this.lastFixMs = nowMs;

    const alpha = this.cfg.smoothingAlpha;
    let smLng: number;
    let smLat: number;
    if (this.prevSmoothedLng == null || this.prevSmoothedLat == null) {
      smLng = lng;
      smLat = lat;
    } else {
      smLng = alpha * lng + (1 - alpha) * this.prevSmoothedLng;
      smLat = alpha * lat + (1 - alpha) * this.prevSmoothedLat;
    }
    this.prevSmoothedLng = smLng;
    this.prevSmoothedLat = smLat;
    this.lastSmoothed.set({ lng: smLng, lat: smLat });
    this.lastDeadReckoned.set(false);

    const spd = speedKmh ?? 0;
    const adaptive =
      this.cfg.maxPollIntervalMs / (1 + Math.min(Math.max(spd, 0), 120) / 40);
    const suggestedNextPollMs = Math.round(
      Math.min(
        this.cfg.maxPollIntervalMs,
        Math.max(this.cfg.minPollIntervalMs, adaptive)
      )
    );

    return {
      lng: smLng,
      lat: smLat,
      suggestedNextPollMs,
      isDeadReckoned: false,
    };
  }

  /**
   * Position to feed geofence evaluation at `nowMs`. Uses last smoothed fix when fresh;
   * extrapolates briefly when the last fix is older than the dead-reckoning timeout.
   */
  positionForEvaluation(nowMs: number): { lng: number; lat: number } | null {
    if (this.prevSmoothedLng == null || this.prevSmoothedLat == null) {
      return null;
    }
    const gap = nowMs - this.lastFixMs;
    if (gap <= this.cfg.deadReckoningTimeoutMs) {
      this.lastDeadReckoned.set(false);
      return { lng: this.prevSmoothedLng, lat: this.prevSmoothedLat };
    }

    if (
      this.lastBearingRad == null ||
      this.lastSpeedMs < 0.5 ||
      gap > this.cfg.deadReckoningTimeoutMs * 4
    ) {
      this.lastDeadReckoned.set(true);
      return { lng: this.prevSmoothedLng, lat: this.prevSmoothedLat };
    }

    const dtSec = gap / 1000;
    const distM = this.lastSpeedMs * dtSec;
    const latRad = (this.prevSmoothedLat * Math.PI) / 180;
    const dLat = (distM * Math.cos(this.lastBearingRad)) / 111_000;
    const dLng =
      (distM * Math.sin(this.lastBearingRad)) / (111_000 * Math.max(0.2, Math.cos(latRad)));
    const lng = this.prevSmoothedLng + dLng;
    const lat = this.prevSmoothedLat + dLat;
    this.lastDeadReckoned.set(true);
    return { lng, lat };
  }
}

function bearingRad(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.atan2(y, x);
}
