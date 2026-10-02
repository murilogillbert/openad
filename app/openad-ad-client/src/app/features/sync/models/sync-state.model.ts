/** Preferences key for last applied manifest version (ISO string from API). */
export const SYNC_LAST_MANIFEST_VERSION_KEY = 'openad_sync_last_manifest_version_v1';

export interface SyncStateSnapshot {
  lastManifestVersion: string | null;
}
