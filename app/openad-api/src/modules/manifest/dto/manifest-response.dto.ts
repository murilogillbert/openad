import type { Operation } from 'fast-json-patch';
import type { SpatialEntryContract } from '@openad/api-contracts';

/** Wire shape for POST /manifest success body.data (004 contracts). */
export interface ManifestMediaItemDto {
  mediaId: string;
  hash: string;
  priority: number;
  downloadUrl: string;
  fileSize: number;
  duration: number;
  /** Denormalized from media placement; campaign-level targeting is separate from media bytes. */
  campaignId?: string;
}

export interface ManifestSpatialSectionDto {
  version: string;
  entries: SpatialEntryContract[];
}

export interface ManifestFullDataDto {
  deviceId: string;
  version: string;
  isDelta: false;
  media: ManifestMediaItemDto[];
  spatial: ManifestSpatialSectionDto;
}

export interface ManifestDeltaDataDto {
  deviceId: string;
  version: string;
  previousVersion: string;
  isDelta: true;
  operations: Operation[];
}

export type ManifestResponseDataDto = ManifestFullDataDto | ManifestDeltaDataDto;
