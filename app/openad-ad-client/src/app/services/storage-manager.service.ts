import { Injectable } from '@angular/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Subject, type Observable } from 'rxjs';
import { estimarArmazenamento } from './device-storage';

const CACHE_INDEX_KEY = 'openad_cache_index_v1';
const STORAGE_FULL_EVENT = 'device.storage.full';

export interface CacheIndexEntry {
  assetId: string;
  sizeBytes: number;
  /** Epoch ms — LRU eviction picks smallest first */
  lastPlayedAt: number;
}

type CacheIndex = CacheIndexEntry[];

/**
 * Local media cache bookkeeping + LRU eviction before downloads.
 */
@Injectable({ providedIn: 'root' })
export class StorageManagerService {
  private readonly index: CacheIndex = [];
  private indexLoaded = false;
  private readonly storageFullSubject = new Subject<void>();

  /** Emitted when cache is empty but requested space still cannot be satisfied. */
  readonly storageFullEvent$: Observable<void> =
    this.storageFullSubject.asObservable();

  private logEviction(assetId: string, freedBytes: number): void {
    // eslint-disable-next-line no-console -- tablet structured log (T053)
    console.info(
      JSON.stringify({
        event: 'device.storage.evict',
        assetId,
        freedBytes,
      })
    );
  }

  private logStorageFull(requiredBytes: number, availableBytes: number): void {
    // eslint-disable-next-line no-console -- tablet structured log (T053)
    console.info(
      JSON.stringify({
        event: STORAGE_FULL_EVENT,
        requiredBytes,
        availableBytes,
      })
    );
  }

  private async ensureIndexLoaded(): Promise<void> {
    if (this.indexLoaded) {
      return;
    }
    const { value } = await Preferences.get({ key: CACHE_INDEX_KEY });
    if (value) {
      try {
        const parsed = JSON.parse(value) as CacheIndex;
        this.index.splice(0, this.index.length, ...parsed);
      } catch {
        /* ignore corrupt */
      }
    }
    this.indexLoaded = true;
  }

  private async persistIndex(): Promise<void> {
    await Preferences.set({
      key: CACHE_INDEX_KEY,
      value: JSON.stringify(this.index),
    });
  }

  /**
   * Bytes disponiveis no aparelho.
   *
   * A versao anterior usava `Filesystem.stat({ path: '', directory: Directory.Data })` e lia
   * `free`, que **nao existe** no plugin do Capacitor; caia no `size`, que e o tamanho do
   * proprio diretorio, e devolvia 3452 bytes como espaco livre. Um criativo de 37 KB nao
   * cabia, `ensureSpace` emitia `storage_full` e a sincronizacao abortava — num tablete com
   * disco vazio. Ver `device-storage.ts`.
   */
  async getAvailableBytes(): Promise<number> {
    const emCache = this.index.reduce((a, e) => a + e.sizeBytes, 0);
    const medida = await estimarArmazenamento(emCache);
    return medida.availableBytes;
  }

  /** Evict least-recently-played assets until `requiredBytes` can fit, or emit storage full. */
  async ensureSpace(requiredBytes: number): Promise<void> {
    await this.ensureIndexLoaded();
    let available = await this.getAvailableBytes();
    if (available >= requiredBytes) {
      return;
    }

    const sorted = [...this.index].sort(
      (a, b) => a.lastPlayedAt - b.lastPlayedAt
    );

    for (const entry of sorted) {
      if (available >= requiredBytes) {
        break;
      }
      const idx = this.index.findIndex((e) => e.assetId === entry.assetId);
      if (idx === -1) {
        continue;
      }
      this.index.splice(idx, 1);
      await this.persistIndex();
      try {
        await Filesystem.deleteFile({
          path: `media/${entry.assetId}`,
          directory: Directory.Data,
        });
      } catch {
        /* missing file */
      }
      this.logEviction(entry.assetId, entry.sizeBytes);
      available += entry.sizeBytes;
    }

    if (available < requiredBytes) {
      this.logStorageFull(requiredBytes, available);
      this.storageFullSubject.next();
      throw new Error('storage_full');
    }
  }

  recordPlayback(assetId: string): void {
    void this.ensureIndexLoaded().then(() => {
      const e = this.index.find((x) => x.assetId === assetId);
      if (e) {
        e.lastPlayedAt = Date.now();
        void this.persistIndex();
      }
    });
  }

  registerDownload(assetId: string, sizeBytes: number): void {
    void this.ensureIndexLoaded().then(() => {
      const existing = this.index.find((x) => x.assetId === assetId);
      if (existing) {
        existing.sizeBytes = sizeBytes;
        existing.lastPlayedAt = Date.now();
      } else {
        this.index.push({
          assetId,
          sizeBytes,
          lastPlayedAt: Date.now(),
        });
      }
      void this.persistIndex();
    });
  }

  removeFromCache(assetId: string): void {
    void this.ensureIndexLoaded().then(() => {
      const i = this.index.findIndex((x) => x.assetId === assetId);
      if (i !== -1) {
        this.index.splice(i, 1);
        void this.persistIndex();
      }
    });
  }

  /** Clears cache index and deletes downloaded files under `media/{assetId}` (remote-command CLEAR_CACHE). */
  async clearMediaCache(): Promise<void> {
    await this.ensureIndexLoaded();
    const entries = [...this.index];
    for (const e of entries) {
      try {
        await Filesystem.deleteFile({
          path: `media/${e.assetId}`,
          directory: Directory.Data,
        });
      } catch {
        /* missing file */
      }
    }
    this.index.splice(0, this.index.length);
    await this.persistIndex();
  }

  /** Test hook: replace in-memory index without Preferences. */
  _resetForTest(index: CacheIndex): void {
    this.index.splice(0, this.index.length, ...index);
    this.indexLoaded = true;
  }
}
