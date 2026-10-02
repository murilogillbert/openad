import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  Directory,
  Encoding,
  Filesystem,
} from '@capacitor/filesystem';
import type { PlayRecordPayload } from '@openad/api-contracts';

const PENDING_FILE = 'analytics/pending_plays.json';
const LS_KEY = 'openad_analytics_pending_plays_v1';

interface PendingRow extends PlayRecordPayload {
  uploaded: 0 | 1;
  createdAt: string;
}

interface PendingStore {
  plays: PendingRow[];
}

/**
 * Durable offline buffer for play records (spec `data-model.md` — `pending_plays`).
 * Native: JSON file under {@link Directory.Data}. Web dev: localStorage fallback.
 */
@Injectable()
export class PlayRecordBufferService {
  private readonly platformId = inject(PLATFORM_ID);

  async enqueuePlay(record: PlayRecordPayload): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const store = await this.readStore();
    const row: PendingRow = {
      ...record,
      uploaded: 0,
      createdAt: new Date().toISOString(),
    };
    store.plays.push(row);
    if (store.plays.length > 2000) {
      store.plays.splice(0, store.plays.length - 2000);
    }
    await this.writeStore(store);
  }

  async peekPendingNotUploaded(limit: number): Promise<PendingRow[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    const store = await this.readStore();
    return store.plays.filter((p) => p.uploaded === 0).slice(0, limit);
  }

  async markUploaded(uniqueEventIds: string[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || uniqueEventIds.length === 0) {
      return;
    }
    const set = new Set(uniqueEventIds);
    const store = await this.readStore();
    for (const p of store.plays) {
      if (set.has(p.uniqueEventId)) {
        p.uploaded = 1;
      }
    }
    await this.writeStore(store);
  }

  private async readStore(): Promise<PendingStore> {
    if (Capacitor.isNativePlatform()) {
      try {
        const { data } = await Filesystem.readFile({
          path: PENDING_FILE,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        const text = typeof data === 'string' ? data : String(data);
        const parsed = JSON.parse(text) as PendingStore;
        if (Array.isArray(parsed.plays)) {
          return parsed;
        }
      } catch {
        /* first run */
      }
      return { plays: [] };
    }
    try {
      const raw = globalThis.localStorage?.getItem(LS_KEY);
      if (raw) {
        return JSON.parse(raw) as PendingStore;
      }
    } catch {
      /* ignore */
    }
    return { plays: [] };
  }

  private async writeStore(store: PendingStore): Promise<void> {
    const json = JSON.stringify(store);
    if (Capacitor.isNativePlatform()) {
      await Filesystem.writeFile({
        path: PENDING_FILE,
        directory: Directory.Data,
        data: json,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      return;
    }
    try {
      globalThis.localStorage?.setItem(LS_KEY, json);
    } catch {
      /* ignore */
    }
  }
}
