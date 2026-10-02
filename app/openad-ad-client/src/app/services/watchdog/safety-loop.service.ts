import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { ManifestHealthService } from '../manifest-health.service';

const STALE_HOURS = 24;

/**
 * Safety Loop: after 24h without manifest, flag for fallback asset loop (003 FR-018).
 */
@Injectable({ providedIn: 'root' })
export class SafetyLoopService {
  private readonly manifestHealth = inject(ManifestHealthService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly inSafetyLoop = signal(false);

  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (!isPlatformBrowser(this.platformId) || this.timer !== null) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  async tick(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const stale = await this.manifestHealth.isStale(STALE_HOURS);
    if (stale && !this.inSafetyLoop()) {
      this.inSafetyLoop.set(true);
      // eslint-disable-next-line no-console -- tablet structured log
      console.warn(
        JSON.stringify({
          event: 'manifest_unreachable',
          reason: 'stale_manifest_24h',
        })
      );
    }
    if (!stale && this.inSafetyLoop()) {
      this.inSafetyLoop.set(false);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
