import { Injectable, inject } from '@angular/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { StorageManagerService as CacheIndexService } from '../../../services/storage-manager.service';

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Writes verified media under `media/{mediaId}` and updates the global cache index.
 * Priority-based eviction when storage is exhausted (see {@link pruneLowestPriorityFirst}).
 */
@Injectable()
export class SyncStorageManagerService {
  private readonly cacheIndex = inject(CacheIndexService);

  async writeMediaFile(mediaId: string, buffer: ArrayBuffer): Promise<void> {
    const data = arrayBufferToBase64(buffer);
    await Filesystem.writeFile({
      path: `media/${mediaId}`,
      directory: Directory.Data,
      data,
    });
    this.cacheIndex.registerDownload(mediaId, buffer.byteLength);
  }

  /**
   * Tamanho do arquivo local, ou `null` quando nao existe.
   *
   * Usado para nao rebaixar midia que ja esta em disco. Sem isso, cada sincronizacao
   * rebaixa o catalogo inteiro — num tablet com 500 MB de midia e sincronizacao de 15 em
   * 15 minutos, isso e da ordem de dezenas de GB por dia em link movel.
   */
  async getMediaFileSize(mediaId: string): Promise<number | null> {
    try {
      const stat = await Filesystem.stat({
        path: `media/${mediaId}`,
        directory: Directory.Data,
      });
      return typeof stat.size === 'number' ? stat.size : null;
    } catch {
      return null;
    }
  }

  async deleteMediaFile(mediaId: string): Promise<void> {
    try {
      await Filesystem.deleteFile({
        path: `media/${mediaId}`,
        directory: Directory.Data,
      });
    } catch {
      /* missing */
    }
    this.cacheIndex.removeFromCache(mediaId);
  }

  /**
   * Deletes on-disk assets starting from the lowest `priority` until at least `bytesToFree`
   * cumulative `fileSize` has been removed (best-effort).
   */
  async pruneLowestPriorityFirst(
    entries: { mediaId: string; priority: number; fileSize: number }[],
    bytesToFree: number
  ): Promise<void> {
    const sorted = [...entries].sort((a, b) => a.priority - b.priority);
    let freed = 0;
    for (const e of sorted) {
      if (freed >= bytesToFree) {
        break;
      }
      await this.deleteMediaFile(e.mediaId);
      freed += e.fileSize;
    }
  }
}
