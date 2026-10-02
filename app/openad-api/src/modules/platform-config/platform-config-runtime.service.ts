import { Injectable, OnModuleInit } from '@nestjs/common';
import type { PlatformConfig } from '@openad/api-contracts';
import { PlatformConfigService } from './platform-config.service';

/**
 * Runtime config accessor for hot-path services.
 * - Always has a usable snapshot (defaults)
 * - Best-effort refresh from Mongo, without blocking callers
 */
@Injectable()
export class PlatformConfigRuntimeService implements OnModuleInit {
  private snapshot: PlatformConfig;
  private lastRefreshAt = 0;
  private refreshInFlight: Promise<void> | null = null;

  constructor(private readonly svc: PlatformConfigService) {
    this.snapshot = this.svc.defaults();
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** Synchronous snapshot; triggers background refresh if stale. */
  get(): PlatformConfig {
    const now = Date.now();
    if (now - this.lastRefreshAt > 30_000) {
      void this.refresh();
    }
    return this.snapshot;
  }

  async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const doc = await this.svc.getOrCreateDefaults();
        this.snapshot = this.svc.mergeWithDefaults(doc.config);
        this.lastRefreshAt = Date.now();
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }
}

