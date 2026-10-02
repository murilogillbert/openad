import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import type { CachedManifestDocument } from '../models/manifest-api.model';

const DB_NAME = 'openad_sync_v1';
const DB_VERSION = 1;
const STORE_PROGRESS = 'downloadProgress';
const STORE_MANIFEST = 'manifestCache';

/**
 * IndexedDB persistence for resumable download byte offsets and last manifest JSON (delta support).
 * Falls back to in-memory maps when IndexedDB is unavailable (SSR/tests).
 */
@Injectable()
export class DownloadProgressIdbService {
  private readonly platformId = inject(PLATFORM_ID);
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly memoryOffsets = new Map<string, number>();
  private memoryManifest: CachedManifestDocument | null = null;

  private browser(): boolean {
    return isPlatformBrowser(this.platformId) && typeof indexedDB !== 'undefined';
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (!this.browser()) {
      return Promise.resolve(null);
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = (): void => reject(req.error ?? new Error('IDB open failed'));
        req.onsuccess = (): void => resolve(req.result);
        req.onupgradeneeded = (): void => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
            db.createObjectStore(STORE_PROGRESS);
          }
          if (!db.objectStoreNames.contains(STORE_MANIFEST)) {
            db.createObjectStore(STORE_MANIFEST);
          }
        };
      });
    }
    return this.dbPromise;
  }

  async getDownloadOffset(mediaId: string): Promise<number> {
    const db = await this.openDb();
    if (!db) {
      return this.memoryOffsets.get(mediaId) ?? 0;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readonly');
      const req = tx.objectStore(STORE_PROGRESS).get(mediaId);
      req.onerror = (): void => reject(req.error);
      req.onsuccess = (): void =>
        resolve(typeof req.result === 'number' ? req.result : 0);
    });
  }

  async setDownloadOffset(mediaId: string, offset: number): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      this.memoryOffsets.set(mediaId, offset);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      tx.objectStore(STORE_PROGRESS).put(offset, mediaId);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
    });
  }

  async clearDownloadOffset(mediaId: string): Promise<void> {
    const db = await this.openDb();
    this.memoryOffsets.delete(mediaId);
    if (!db) {
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      tx.objectStore(STORE_PROGRESS).delete(mediaId);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
    });
  }

  async getCachedManifest(): Promise<CachedManifestDocument | null> {
    const db = await this.openDb();
    if (!db) {
      return this.memoryManifest;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MANIFEST, 'readonly');
      const req = tx.objectStore(STORE_MANIFEST).get('last');
      req.onerror = (): void => reject(req.error);
      req.onsuccess = (): void => {
        const v = req.result as CachedManifestDocument | undefined;
        resolve(v ?? null);
      };
    });
  }

  async setCachedManifest(doc: CachedManifestDocument): Promise<void> {
    const db = await this.openDb();
    this.memoryManifest = doc;
    if (!db) {
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MANIFEST, 'readwrite');
      tx.objectStore(STORE_MANIFEST).put(doc, 'last');
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
    });
  }

  /** Test hook: reset memory fallback. */
  _resetMemoryForTest(): void {
    this.memoryOffsets.clear();
    this.memoryManifest = null;
  }
}
