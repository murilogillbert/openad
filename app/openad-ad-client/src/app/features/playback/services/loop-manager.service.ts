import { Injectable } from '@angular/core';
import type { ManifestMediaItem } from '../../sync/models/manifest-api.model';

/**
 * Chooses the next manifest item avoiding an immediate repeat; commits last-played only via {@link commitPlayed}.
 */
@Injectable()
export class LoopManagerService {
  private lastPlayedId: string | null = null;

  selectNext(candidates: ManifestMediaItem[]): ManifestMediaItem | null {
    if (candidates.length === 0) {
      return null;
    }
    const avoidRepeat = candidates.filter((c) => c.mediaId !== this.lastPlayedId);
    const pool = avoidRepeat.length > 0 ? avoidRepeat : candidates;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx] ?? null;
  }

  commitPlayed(item: ManifestMediaItem): void {
    this.lastPlayedId = item.mediaId;
  }

  setLastPlayedId(mediaId: string | null): void {
    this.lastPlayedId = mediaId;
  }

  reset(): void {
    this.lastPlayedId = null;
  }
}
