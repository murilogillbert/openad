import { Injectable, inject, signal } from '@angular/core';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { PlaybackEngineService } from '../../playback/services/playback-engine.service';
import { DownloadProgressIdbService } from '../../sync/services/download-progress-idb.service';
import {
  isPointInSpatialGeometry,
  withinExpandedGeometry,
} from '../utils/spatial-geometry.util';
import { ShadowQueueService } from './shadow-queue.service';
import { SpatialArbitrationEngineService } from './spatial-arbitration-engine.service';
import type { SpatialPlaybackArbitrationSnapshot } from './spatial-arbitration-engine.service';
import { SpatialCooldownStoreService } from './spatial-cooldown-store.service';
import { SpatialTelemetryService } from './spatial-telemetry.service';

/** Per (zoneId, mediaId) binding — tracks hysteresis bands and dwell on nominal time only. */
interface ZoneState {
  prevNominal: boolean;
  prevExpanded: boolean;
  dwellAccNominalMs: number;
  lastNominalTickMs: number | null;
  lastFiredAtMs: number | null;
}

/**
 * Local geofence evaluation against cached spatial manifest (005).
 * Exit uses expanded geometry (nominal + hysteresisExitMeters) to reduce boundary flicker (FR-010).
 */
@Injectable({ providedIn: 'root' })
export class GeofenceMonitorService {
  private readonly idb = inject(DownloadProgressIdbService);
  private readonly arbitration = inject(SpatialArbitrationEngineService);
  private readonly playback = inject(PlaybackEngineService);
  private readonly shadow = inject(ShadowQueueService);
  private readonly cooldownStore = inject(SpatialCooldownStoreService);
  private readonly telemetry = inject(SpatialTelemetryService);

  private readonly state = new Map<string, ZoneState>();

  /** Last geofence evaluation duration (ms), for observability (005 T067). */
  readonly lastEvaluationDurationMs = signal(0);

  private stateFor(key: string): ZoneState {
    let st = this.state.get(key);
    if (!st) {
      st = {
        prevNominal: false,
        prevExpanded: false,
        dwellAccNominalMs: 0,
        lastNominalTickMs: null,
        lastFiredAtMs: null,
      };
      this.state.set(key, st);
    }
    return st;
  }

  async evaluatePosition(
    lng: number,
    lat: number,
    nowMs: number
  ): Promise<SpatialEntryContract[]> {
    const t0 =
      typeof globalThis.performance !== 'undefined'
        ? globalThis.performance.now()
        : 0;
    try {
      const doc = await this.idb.getCachedManifest();
      const baseEntries = doc?.spatial?.entries ?? [];
      const shadowBack = this.shadow.noteTrajectory(lng, lat);
      const extraKeys = new Set(
        shadowBack.map((e) => `${e.zoneId}:${e.mediaId}`)
      );
      const entries = [
        ...shadowBack,
        ...baseEntries.filter(
          (e) => !extraKeys.has(`${e.zoneId}:${e.mediaId}`)
        ),
      ];

      const eligible: SpatialEntryContract[] = [];

      for (const entry of entries) {
        const bufferM = entry.hysteresisExitMeters ?? 0;
        const nominal = isPointInSpatialGeometry(lng, lat, entry.geometry);
        const expanded = withinExpandedGeometry(
          lng,
          lat,
          entry.geometry,
          bufferM
        );
        const key = `${entry.zoneId}:${entry.mediaId}`;
        const st = this.stateFor(key);

        if (!expanded) {
          st.prevNominal = false;
          st.prevExpanded = false;
          st.dwellAccNominalMs = 0;
          st.lastNominalTickMs = null;
          continue;
        }

        if (entry.trigger.mode === 'entry') {
          const entryFire =
            nominal &&
            !st.prevNominal &&
            !st.prevExpanded &&
            (await this.canFire(entry, st, nowMs));
          if (entryFire) {
            eligible.push(entry);
            await this.recordFire(entry, st, nowMs);
          }
          st.prevNominal = nominal;
          st.prevExpanded = true;
          continue;
        }

        const dwellSec = entry.trigger.dwellSeconds ?? 0;
        if (nominal) {
          if (st.lastNominalTickMs != null) {
            st.dwellAccNominalMs += nowMs - st.lastNominalTickMs;
          }
          st.lastNominalTickMs = nowMs;
          if (
            st.dwellAccNominalMs >= dwellSec * 1000 &&
            (await this.canFire(entry, st, nowMs))
          ) {
            eligible.push(entry);
            await this.recordFire(entry, st, nowMs);
            st.dwellAccNominalMs = 0;
          }
        } else {
          st.lastNominalTickMs = null;
        }
        st.prevNominal = nominal;
        st.prevExpanded = true;
      }

      const tierFiltered = this.arbitration.filterByTier(eligible);
      await this.emitTierLossesIfNeeded(tierFiltered, eligible, nowMs);

      const snap = this.playback.getSpatialArbitrationSnapshot();
      const arbSnap: SpatialPlaybackArbitrationSnapshot = {
        playbackStatus: snap.playbackStatus,
        currentKind: snap.currentKind,
      };

      const afterLoop = this.arbitration.applyLoopInterruptPolicy(
        tierFiltered,
        arbSnap,
        this.shadow,
        lng,
        lat
      );

      if (tierFiltered.length > 0 && afterLoop.length === 0) {
        const win = tierFiltered[0]!;
        await this.emitLoopLockLosses(tierFiltered, win, nowMs);
      }

      if (afterLoop.length === 0) return [];
      const mode = afterLoop[0]!.rotation;
      const pick = this.arbitration.pickAmongPeers(
        afterLoop,
        mode,
        'tick'
      );
      return pick ? [pick] : [];
    } finally {
      if (typeof globalThis.performance !== 'undefined') {
        this.lastEvaluationDurationMs.set(
          globalThis.performance.now() - t0
        );
      }
    }
  }

  private async recordFire(
    entry: SpatialEntryContract,
    st: ZoneState,
    nowMs: number
  ): Promise<void> {
    st.lastFiredAtMs = nowMs;
    await this.cooldownStore.setLastFireMs(
      entry.zoneId,
      entry.mediaId,
      nowMs
    );
  }

  private async canFire(
    entry: SpatialEntryContract,
    st: ZoneState,
    nowMs: number
  ): Promise<boolean> {
    const cool = entry.cooldownSeconds ?? 0;
    if (cool <= 0) return true;
    const mem = st.lastFiredAtMs ?? 0;
    const disk =
      (await this.cooldownStore.getLastFireMs(
        entry.zoneId,
        entry.mediaId
      )) ?? 0;
    const last = Math.max(mem, disk);
    if (last === 0) return true;
    return nowMs - last >= cool * 1000;
  }

  private async emitTierLossesIfNeeded(
    tierFiltered: SpatialEntryContract[],
    eligible: SpatialEntryContract[],
    nowMs: number
  ): Promise<void> {
    if (tierFiltered.length === 0 || eligible.length <= 1) return;
    const win = new Set(
      tierFiltered.map((e) => `${e.zoneId}:${e.mediaId}`)
    );
    const losers = eligible.filter((e) => !win.has(`${e.zoneId}:${e.mediaId}`));
    if (losers.length === 0) return;
    const winnerId = tierFiltered[0]?.mediaId ?? null;
    const ts = new Date(nowMs).toISOString();
    await this.telemetry.publishLostOpportunityEvents(
      losers.map((e) => ({
        eventId: crypto.randomUUID(),
        suppressedMediaId: e.mediaId,
        winningMediaId: winnerId,
        reason: 'higher_tier' as const,
        zoneId: e.zoneId,
        ts,
      }))
    );
  }

  private async emitLoopLockLosses(
    deferred: SpatialEntryContract[],
    winner: SpatialEntryContract,
    nowMs: number
  ): Promise<void> {
    const ts = new Date(nowMs).toISOString();
    await this.telemetry.publishLostOpportunityEvents(
      deferred.map((e) => ({
        eventId: crypto.randomUUID(),
        suppressedMediaId: e.mediaId,
        winningMediaId: winner.mediaId,
        reason: 'loop_lock' as const,
        zoneId: e.zoneId,
        ts,
      }))
    );
  }
}
