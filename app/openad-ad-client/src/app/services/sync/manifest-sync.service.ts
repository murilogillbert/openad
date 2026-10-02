import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import type { ManifestDeltaResponse } from '@openad/api-contracts';
import { ApiClientService } from '../api-client.service';
import { DeviceFleetContextService } from '../device-fleet-context.service';
import { DeviceSessionService } from '../device-session.service';
import { MqttClientService } from '../../features/mqtt/services/mqtt-client.service';
import { StorageManagerService } from '../storage-manager.service';
import {
  SyncWindowSchedulerService,
  type SyncWindowRuleLike,
} from './sync-window-scheduler.service';
import { ResumableDownloadService } from './resumable-download.service';

const MANIFEST_VERSION_KEY = 'openad_local_manifest_version_v1';

/**
 * Fetches manifest deltas, applies removals to cache index, downloads added assets
 * with sync-window gating and resumable HTTP (003 User Story 4).
 */
@Injectable({ providedIn: 'root' })
export class ManifestSyncService {
  private readonly api = inject(ApiClientService);
  private readonly session = inject(DeviceSessionService);
  private readonly fleetContext = inject(DeviceFleetContextService);
  private readonly mqtt = inject(MqttClientService);
  private readonly scheduler = inject(SyncWindowSchedulerService);
  private readonly resumable = inject(ResumableDownloadService);
  private readonly storage = inject(StorageManagerService);

  private lastSyncRules: SyncWindowRuleLike[] | undefined;
  private bypassSyncWindow = false;

  constructor() {
    this.mqtt.deviceConfig$.subscribe((cfg) => {
      this.lastSyncRules = cfg.syncWindows;
    });
  }

  /** EMERGENCY_SYNC (003) — next sync ignores sync windows (use with `forceFullSync`). */
  requestEmergencySync(): void {
    this.bypassSyncWindow = true;
  }

  /** After CLEAR_CACHE, force a full manifest pass (FR-028). */
  onCacheCleared(): void {
    this.bypassSyncWindow = true;
    void Preferences.set({ key: MANIFEST_VERSION_KEY, value: '0' });
  }

  async getLocalManifestVersion(): Promise<number> {
    const { value } = await Preferences.get({ key: MANIFEST_VERSION_KEY });
    if (!value) {
      return 0;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async runManifestSync(opts?: { forceFullSync?: boolean }): Promise<void> {
    const deviceId = await this.session.getStoredDeviceId();
    if (!deviceId) {
      return;
    }
    void this.fleetContext.refreshBoundVehicle();

    const since =
      opts?.forceFullSync === true
        ? 0
        : await this.getLocalManifestVersion();
    const q =
      since <= 0 ? '' : `?sinceVersion=${encodeURIComponent(String(since))}`;
    const delta = await this.api.getWithAuth<ManifestDeltaResponse>(
      `/api/v1/devices/${encodeURIComponent(deviceId)}/manifest${q}`
    );

    const bypassWindows =
      opts?.forceFullSync === true ||
      this.bypassSyncWindow ||
      delta.fullSync;
    if (this.bypassSyncWindow) {
      this.bypassSyncWindow = false;
    }

    for (const id of delta.removed) {
      this.storage.removeFromCache(id);
    }

    const rules = this.lastSyncRules;
    const now = new Date();

    for (const a of delta.added) {
      const ok = this.scheduler.allowsDownload(a.sizeBytes, rules, now, {
        bypassWindow: bypassWindows,
      });
      if (!ok) {
        continue;
      }
      const key = `openad_dl_off_${encodeURIComponent(a.assetId)}`;
      await this.resumable.downloadToBuffer(a.url, {
        getOffset: async () => {
          const { value } = await Preferences.get({ key });
          return value ? Number(value) : 0;
        },
        setOffset: async (n) => {
          await Preferences.set({ key, value: String(n) });
        },
      });
      await Preferences.remove({ key });
      this.storage.registerDownload(a.assetId, a.sizeBytes);
    }

    await Preferences.set({
      key: MANIFEST_VERSION_KEY,
      value: String(delta.version),
    });
  }
}
