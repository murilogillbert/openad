import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { applyPatch } from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import { DeviceSessionService } from '../../../services/device-session.service';
import { StorageManagerService as CacheIndexService } from '../../../services/storage-manager.service';
import { SYNC_LAST_MANIFEST_VERSION_KEY } from '../models/sync-state.model';
import type {
  CachedManifestDocument,
  DownloadedMediaEntry,
  ManifestSuccessResponse,
} from '../models/manifest-api.model';
import { DownloadProgressIdbService } from './download-progress-idb.service';
import { DownloadManagerService } from './download-manager.service';
import { ManifestClientService } from './manifest-client.service';
import { SyncStorageManagerService } from './storage-manager.service';
import { ManifestSyncEventsService } from './manifest-sync-events.service';
import { DeviceInfoService } from '../../../core/services/device-info.service';

const MAX_DELTA_RETRIES = 2;

/**
 * Fetches manifest (full or delta), downloads media with resume + verification, prunes removed assets, reports sync status.
 */
@Injectable()
export class SyncOrchestratorService {
  private readonly session = inject(DeviceSessionService);
  private readonly manifestClient = inject(ManifestClientService);
  private readonly downloads = inject(DownloadManagerService);
  private readonly syncStorage = inject(SyncStorageManagerService);
  private readonly idb = inject(DownloadProgressIdbService);
  private readonly cacheIndex = inject(CacheIndexService);
  private readonly manifestEvents = inject(ManifestSyncEventsService);
  private readonly deviceInfo = inject(DeviceInfoService);

  /**
   * End-to-end sync. Uses cached manifest for JSON Patch when the API returns a delta.
   */
  async syncNow(options?: { forceFull?: boolean }): Promise<void> {
    const deviceId = await this.session.getStoredDeviceId();
    const token = await this.session.getAccessToken();
    if (!deviceId || !token) {
      throw new Error('not_paired');
    }

    const { value: storedVersion } = await Preferences.get({
      key: SYNC_LAST_MANIFEST_VERSION_KEY,
    });
    const lastManifestVersion = options?.forceFull
      ? undefined
      : storedVersion ?? undefined;

    const loc = this.deviceInfo.location();
    const deviceState = loc
      ? {
          latitude: loc.latitude,
          longitude: loc.longitude,
          speed: loc.speedKmh,
          timestamp: loc.timestamp,
        }
      : { timestamp: new Date().toISOString() };

    const res = await this.manifestClient.fetchManifest({
      deviceId,
      lastManifestVersion,
      deviceState,
    });

    if (!res.success) {
      throw new Error('manifest_failed');
    }

    await this.applyManifestResponse(res, deviceId, 0);
  }

  private async applyManifestResponse(
    res: ManifestSuccessResponse,
    deviceId: string,
    depth: number
  ): Promise<void> {
    if (depth > MAX_DELTA_RETRIES) {
      throw new Error('manifest_delta_retry_exhausted');
    }

    const prevDoc = await this.idb.getCachedManifest();
    const data = res.data;

    let doc: CachedManifestDocument;

    if (data.isDelta) {
      if (!prevDoc) {
        await this.applyManifestResponse(
          await this.manifestClient.fetchManifest({
            deviceId,
            lastManifestVersion: undefined,
          }),
          deviceId,
          depth + 1
        );
        return;
      }
      const baseDoc: CachedManifestDocument =
        prevDoc.spatial != null
          ? prevDoc
          : {
              ...prevDoc,
              spatial: { version: prevDoc.version, entries: [] },
            };
      const clone = structuredClone(baseDoc) as object;
      const result = applyPatch(clone, data.operations as Operation[], true, false);
      doc = result.newDocument as CachedManifestDocument;
    } else {
      doc = {
        deviceId: data.deviceId,
        version: data.version,
        media: data.media,
        spatial: data.spatial,
      };
    }

    const prevIds = new Set(
      (prevDoc?.media ?? []).map((m) => m.mediaId)
    );
    const keepIds = new Set(doc.media.map((m) => m.mediaId));

    await this.idb.setCachedManifest(doc);

    for (const oldId of prevIds) {
      if (!keepIds.has(oldId)) {
        await this.syncStorage.deleteMediaFile(oldId);
      }
    }

    const downloaded: DownloadedMediaEntry[] = [];

    for (const item of doc.media) {
      await this.ensureSpaceWithPriorityEviction(doc, item.fileSize);
      const buf = await this.downloads.downloadVerifiedMedia({
        url: item.downloadUrl,
        mediaId: item.mediaId,
        expectedHash: item.hash,
        expectedSize: item.fileSize,
      });
      await this.syncStorage.writeMediaFile(item.mediaId, buf);
      downloaded.push({
        mediaId: item.mediaId,
        hash: item.hash,
        verified: true,
      });
    }

    const storageUsed = doc.media.reduce((a, m) => a + m.fileSize, 0);

    await Preferences.set({
      key: SYNC_LAST_MANIFEST_VERSION_KEY,
      value: doc.version,
    });

    await this.manifestClient.reportSyncStatus({
      deviceId,
      manifestVersion: doc.version,
      syncedAt: new Date().toISOString(),
      downloadedMedia: downloaded,
      storageUsed,
    });

    this.manifestEvents.notifyManifestSynced();
  }

  private async ensureSpaceWithPriorityEviction(
    doc: CachedManifestDocument,
    requiredBytes: number
  ): Promise<void> {
    try {
      await this.cacheIndex.ensureSpace(requiredBytes);
    } catch (e) {
      if (e instanceof Error && e.message === 'storage_full') {
        const entries = doc.media.map((m) => ({
          mediaId: m.mediaId,
          priority: m.priority,
          fileSize: m.fileSize,
        }));
        await this.syncStorage.pruneLowestPriorityFirst(entries, requiredBytes);
        await this.cacheIndex.ensureSpace(requiredBytes);
        return;
      }
      throw e;
    }
  }
}
