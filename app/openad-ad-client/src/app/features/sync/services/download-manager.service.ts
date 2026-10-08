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
  /**
   * Busca uma URL pre-assinada nova quando o storage responde `403`.
   *
   * A URL do manifesto vale 1 h, e a retomada depois disso levaria `403` sem este gancho — o
   * tablete ficaria sem o criativo ate o ciclo seguinte de sync.
   */
  refreshUrl?: () => Promise<string | null>;
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
          loadPartial: () => this.idb.getPartial(opts.mediaId),
          appendPartial: (chunk) => this.idb.appendPartial(opts.mediaId, chunk),
          clearPartial: () => this.idb.clearPartial(opts.mediaId),
          refreshUrl: opts.refreshUrl,
          fetchFn: opts.fetchFn,
        });
        /**
         * Hash ou tamanho errado significa que os bytes guardados nao servem, entao o parcial e
         * apagado antes de tentar de novo — senao a tentativa seguinte retomaria de cima de um
         * arquivo que ja se sabe corrompido e falharia igual, gastando as cinco tentativas sem
         * nunca baixar de verdade.
         */
        const ok = await this.hashes.verifyHex(buf, opts.expectedHash);
        if (!ok) {
          await this.idb.clearPartial(opts.mediaId);
          throw new Error('hash_mismatch');
        }
        if (opts.expectedSize > 0 && buf.byteLength !== opts.expectedSize) {
          await this.idb.clearPartial(opts.mediaId);
          throw new Error('size_mismatch');
        }
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
