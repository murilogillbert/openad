import type { Operation } from 'fast-json-patch';
import type { SpatialManifestContract } from '@openad/api-contracts';

/** Mirrors backend ManifestMediaItemDto. */
export interface ManifestMediaItem {
  mediaId: string;
  hash: string;
  priority: number;
  downloadUrl: string;
  fileSize: number;
  duration: number;
  /**
   * `image/jpeg`, `video/mp4`, ... Decide entre `<img>` e `<video>` na tela.
   *
   * Opcional porque o manifesto em cache no IndexedDB pode ter sido gravado por uma versao
   * do servidor anterior a este campo; ausente equivale a video, que era o comportamento
   * unico antes.
   */
  mimeType?: string;
  campaignId?: string;
}

export interface ManifestFullData {
  deviceId: string;
  version: string;
  isDelta: false;
  media: ManifestMediaItem[];
  spatial: SpatialManifestContract;
}

export interface ManifestDeltaData {
  deviceId: string;
  version: string;
  previousVersion: string;
  isDelta: true;
  operations: Operation[];
}

export type ManifestData = ManifestFullData | ManifestDeltaData;

export interface ManifestSuccessResponse {
  success: true;
  data: ManifestData;
}

export interface ManifestRequestBody {
  deviceId: string;
  lastManifestVersion?: string;
  deviceState?: {
    latitude?: number;
    longitude?: number;
    speed?: number;
    timestamp?: string;
  };
}

export interface DownloadedMediaEntry {
  mediaId: string;
  hash: string;
  verified: boolean;
}

export interface SyncStatusBody {
  deviceId: string;
  manifestVersion: string;
  syncedAt: string;
  downloadedMedia: DownloadedMediaEntry[];
  storageUsed?: number;
}

/** Cached manifest document for applying JSON Patch deltas (matches Redis payload shape). */
export interface CachedManifestDocument {
  deviceId: string;
  version: string;
  media: ManifestMediaItem[];
  spatial?: SpatialManifestContract;
}
