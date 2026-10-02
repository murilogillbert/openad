import { Injectable } from '@angular/core';
import type { SpatialEntryContract } from '@openad/api-contracts';
import type { ShadowQueueService } from './shadow-queue.service';

/** Playback view for loop locking (non–Tier-1 defers interrupt; T1 emergency). */
export interface SpatialPlaybackArbitrationSnapshot {
  playbackStatus: 'playing' | 'idle' | 'error';
  currentKind: 'manifest' | 'factory' | 'priority' | null;
}

/**
 * Peer rotation among spatial candidates (same evaluation tick).
 */
@Injectable({ providedIn: 'root' })
export class SpatialArbitrationEngineService {
  private readonly sequentialCursor = new Map<string, number>();

  pickAmongPeers(
    candidates: SpatialEntryContract[],
    mode: SpatialEntryContract['rotation'],
    cursorKey = 'default'
  ): SpatialEntryContract | undefined {
    if (candidates.length === 0) return undefined;
    if (mode === 'priority_first') {
      return [...candidates].sort((a, b) => b.priorityScore - a.priorityScore)[0];
    }
    if (mode === 'sequential') {
      const order = [...candidates];
      const i = this.sequentialCursor.get(cursorKey) ?? 0;
      const pick = order[i % order.length]!;
      this.sequentialCursor.set(cursorKey, i + 1);
      return pick;
    }
    const sorted = [...candidates];
    const weights = sorted.map((c) => Math.max(0.001, c.priorityScore));
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let j = 0; j < sorted.length; j++) {
      r -= weights[j]!;
      if (r <= 0) {
        return sorted[j];
      }
    }
    return sorted[sorted.length - 1];
  }

  filterByTier(candidates: SpatialEntryContract[]): SpatialEntryContract[] {
    const tiers: SpatialEntryContract['tier'][] = ['T1', 'T2', 'T3', 'T4'];
    for (const t of tiers) {
      const at = candidates.filter((c) => c.tier === t);
      if (at.length > 0) return at;
    }
    return [];
  }

  /**
   * When normal loop content is playing (manifest/factory), spatial triggers must not interrupt
   * except Tier-1 emergency. Deferred candidates go to {@link ShadowQueueService}.
   */
  applyLoopInterruptPolicy(
    tierFiltered: SpatialEntryContract[],
    snapshot: SpatialPlaybackArbitrationSnapshot,
    shadow: ShadowQueueService,
    lng: number,
    lat: number
  ): SpatialEntryContract[] {
    if (!this.isLoopPlaybackLocked(snapshot)) {
      return tierFiltered;
    }
    const t1 = tierFiltered.filter((c) => c.tier === 'T1');
    if (t1.length > 0) {
      return t1;
    }
    for (const c of tierFiltered) {
      shadow.enqueue(c, lng, lat);
    }
    return [];
  }

  isLoopPlaybackLocked(snapshot: SpatialPlaybackArbitrationSnapshot): boolean {
    return (
      snapshot.playbackStatus === 'playing' &&
      (snapshot.currentKind === 'manifest' || snapshot.currentKind === 'factory')
    );
  }

  resetSequentialCursor(): void {
    this.sequentialCursor.clear();
  }
}
