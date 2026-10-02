import { Injectable, inject } from '@angular/core';
import { ResumableDownloadService } from '../../../services/sync/resumable-download.service';
import { DownloadProgressIdbService } from './download-progress-idb.service';
import { HashVerifierService } from './hash-verifier.service';

export interface DownloadVerifiedOptions {
  url: string;
  mediaId: string;
  expectedHash: string;
  expectedSize: number;
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * Resumable Range downloads with IndexedDB offsets, SHA-256 verification, and exponential backoff retries.
 */
@Injectable()
export class DownloadManagerService {
  private readonly resumable = inject(ResumableDownloadService);
  private readonly idb = inject(DownloadProgressIdbService);
  private readonly hashes = inject(HashVerifierService);

  async downloadVerifiedMedia(opts: DownloadVerifiedOptions): Promise<ArrayBuffer> {
    const maxAttempts = opts.maxAttempts ?? 5;
    const baseDelayMs = opts.baseDelayMs ?? 400;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const buf = await this.resumable.downloadToBuffer(opts.url, {
          getOffset: () => this.idb.getDownloadOffset(opts.mediaId),
          setOffset: (n) => this.idb.setDownloadOffset(opts.mediaId, n),
          fetchFn: opts.fetchFn,
        });
        const ok = await this.hashes.verifyHex(buf, opts.expectedHash);
        if (!ok) {
          await this.idb.clearDownloadOffset(opts.mediaId);
          throw new Error('hash_mismatch');
        }
        if (opts.expectedSize > 0 && buf.byteLength !== opts.expectedSize) {
          await this.idb.clearDownloadOffset(opts.mediaId);
          throw new Error('size_mismatch');
        }
        await this.idb.clearDownloadOffset(opts.mediaId);
        return buf;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts - 1) {
          await this.delay(baseDelayMs * 2 ** attempt);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
