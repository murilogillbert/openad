import type { ManifestDeltaResponse } from '@openad/api-contracts';

export interface ManifestAssetRow {
  assetId: string;
  url: string;
  checksumSha256: string;
  sizeBytes: number;
}

/**
 * Pure delta between a prior manifest snapshot and the latest snapshot.
 * Snapshots are keyed by `manifestVersion`.
 */
export function computeManifestDelta(
  sinceVersion: number | undefined,
  prevAssets: ManifestAssetRow[] | null,
  latestVersion: number,
  latestAssets: ManifestAssetRow[]
): ManifestDeltaResponse {
  if (latestVersion <= 0) {
    return { version: 0, fullSync: true, added: [], removed: [] };
  }

  const latestIds = new Set(latestAssets.map((a) => a.assetId));

  if (sinceVersion === undefined || sinceVersion === null || sinceVersion === 0) {
    return {
      version: latestVersion,
      fullSync: true,
      added: latestAssets,
      removed: [],
    };
  }

  if (sinceVersion >= latestVersion) {
    return {
      version: latestVersion,
      fullSync: false,
      added: [],
      removed: [],
    };
  }

  if (!prevAssets) {
    return {
      version: latestVersion,
      fullSync: true,
      added: latestAssets,
      removed: [],
    };
  }

  const prevIds = new Set(prevAssets.map((a) => a.assetId));
  const added = latestAssets.filter((a) => !prevIds.has(a.assetId));
  const removed = [...prevIds].filter((id) => !latestIds.has(id));

  return {
    version: latestVersion,
    fullSync: false,
    added,
    removed,
  };
}
