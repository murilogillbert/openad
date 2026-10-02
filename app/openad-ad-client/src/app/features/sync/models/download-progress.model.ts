/** Per-asset download resume state persisted in IndexedDB. */
export interface DownloadProgressRecord {
  mediaId: string;
  bytesReceived: number;
  /** Total bytes when known (from Content-Range). */
  totalBytes?: number;
  updatedAt: number;
}
