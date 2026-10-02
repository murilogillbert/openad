import type { ManifestMediaItem } from '../../sync/models/manifest-api.model';

export interface PriorityAd {
  commandId: string;
  mediaId: string;
  expiresAt: string;
}

export type QueuedAd =
  | { kind: 'manifest'; item: ManifestMediaItem }
  | { kind: 'factory'; url: string; mediaId: string }
  | { kind: 'priority'; item: ManifestMediaItem; command: PriorityAd };
