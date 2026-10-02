import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

const KEY = 'openad_last_manifest_fetch_at_ms';

/**
 * Tracks last successful manifest / capability sync for Safety Loop (24h staleness).
 */
@Injectable({ providedIn: 'root' })
export class ManifestHealthService {
  private readonly platformId = inject(PLATFORM_ID);

  async recordSuccessfulFetch(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    await Preferences.set({
      key: KEY,
      value: String(Date.now()),
    });
  }

  async lastFetchEpochMs(): Promise<number | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const { value } = await Preferences.get({ key: KEY });
    if (!value) {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** True when no fetch or last fetch older than `hours`. */
  async isStale(hours: number): Promise<boolean> {
    const t = await this.lastFetchEpochMs();
    if (t == null) {
      return true;
    }
    return Date.now() - t > hours * 3_600_000;
  }

  /** Test hook */
  _resetForTest(): void {
    void Preferences.remove({ key: KEY });
  }
}
