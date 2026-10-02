import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

const DB_NAME = 'openad_spatial_v1';
const DB_VERSION = 1;
const STORE = 'spatialCooldown';

/**
 * Remembers last fire timestamps per zone/media for re-trigger policy (005 US5).
 * Uses IndexedDB in the browser and an in-memory map in SSR/tests.
 */
@Injectable({ providedIn: 'root' })
export class SpatialCooldownStoreService {
  private readonly platformId = inject(PLATFORM_ID);
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly memory = new Map<string, number>();

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
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
          }
        };
      });
    }
    return this.dbPromise;
  }

  private key(zoneId: string, mediaId: string): string {
    return `${zoneId}:${mediaId}`;
  }

  async getLastFireMs(zoneId: string, mediaId: string): Promise<number | null> {
    const k = this.key(zoneId, mediaId);
    const db = await this.openDb();
    if (!db) {
      return this.memory.get(k) ?? null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(k);
      req.onerror = (): void => reject(req.error);
      req.onsuccess = (): void =>
        resolve(typeof req.result === 'number' ? req.result : null);
    });
  }

  async setLastFireMs(
    zoneId: string,
    mediaId: string,
    atMs: number
  ): Promise<void> {
    const k = this.key(zoneId, mediaId);
    const db = await this.openDb();
    if (!db) {
      this.memory.set(k, atMs);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(atMs, k);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
    });
  }
}
