import { isR2StorageRef } from '../../infrastructure/storage/asset-storage.service';

/**
 * Canonical S3 key for refcount / GC (VFS `storageKey` or `r2:` + key from `storageUrl`).
 */
export function canonicalStorageKey(row: {
  storageKey?: string | null;
  storageUrl?: string | null;
}): string | null {
  if (row.storageKey?.trim()) {
    return row.storageKey.trim();
  }
  if (row.storageUrl && isR2StorageRef(row.storageUrl)) {
    return row.storageUrl.slice('r2:'.length);
  }
  return null;
}
