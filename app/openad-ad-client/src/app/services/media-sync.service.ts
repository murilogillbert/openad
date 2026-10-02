import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { StorageManagerService } from './storage-manager.service';

const CHECKPOINT_PREFIX = 'openad_dl_ck_';

export interface DownloadCheckpoint {
  assetId: string;
  downloadedBytes: number;
  totalBytes: number;
  etag: string | null;
}

export interface MediaAssetRef {
  assetId: string;
  sizeBytes: number;
  url: string;
}

/**
 * Orchestrates media downloads with LRU eviction and byte-range resume.
 */
@Injectable({ providedIn: 'root' })
export class MediaSyncService {
  private readonly storage = inject(StorageManagerService);

  async downloadAsset(asset: MediaAssetRef): Promise<void> {
    try {
      await this.storage.ensureSpace(asset.sizeBytes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'storage_full') {
        // eslint-disable-next-line no-console
        console.warn(
          `[MediaSync] skipped download ${asset.assetId}: storage_full after eviction`
        );
      }
      return;
    }

    const ck = await this.loadCheckpoint(asset.assetId);
    const headers: Record<string, string> = {};
    if (ck && ck.downloadedBytes > 0 && ck.etag) {
      headers['If-None-Match'] = ck.etag;
      headers['Range'] = `bytes=${ck.downloadedBytes}-`;
    }

    const res = await fetch(asset.url, { headers });
    if (res.status === 412 || res.status === 416) {
      // eslint-disable-next-line no-console
      console.warn(`[MediaSync] ETag/range mismatch for ${asset.assetId}, restarting`);
      await this.clearCheckpoint(asset.assetId);
      return this.downloadAsset(asset);
    }

    const etag = res.headers.get('etag');
    const total = Number(res.headers.get('content-length') ?? asset.sizeBytes) + (ck?.downloadedBytes ?? 0);

    const reader = res.body?.getReader();
    if (!reader) {
      return;
    }

    let downloaded = ck?.downloadedBytes ?? 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      downloaded += value?.length ?? 0;
      await this.saveCheckpoint({
        assetId: asset.assetId,
        downloadedBytes: downloaded,
        totalBytes: total,
        etag: etag ?? ck?.etag ?? null,
      });
    }

    await this.clearCheckpoint(asset.assetId);
    this.storage.registerDownload(asset.assetId, asset.sizeBytes);
  }

  private async loadCheckpoint(assetId: string): Promise<DownloadCheckpoint | null> {
    const { value } = await Preferences.get({ key: CHECKPOINT_PREFIX + assetId });
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as DownloadCheckpoint;
    } catch {
      return null;
    }
  }

  private async saveCheckpoint(ck: DownloadCheckpoint): Promise<void> {
    await Preferences.set({
      key: CHECKPOINT_PREFIX + ck.assetId,
      value: JSON.stringify(ck),
    });
  }

  private async clearCheckpoint(assetId: string): Promise<void> {
    await Preferences.remove({ key: CHECKPOINT_PREFIX + assetId });
  }
}
