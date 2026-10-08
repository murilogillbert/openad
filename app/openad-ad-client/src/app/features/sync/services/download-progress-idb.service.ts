import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import type { CachedManifestDocument } from '../models/manifest-api.model';

const DB_NAME = 'openad_sync_v1';
/**
 * Versao 2: acrescenta `downloadChunks`.
 *
 * Antes desta versao so o **offset** era persistido, e os bytes ficavam num vetor em memoria
 * dentro de `downloadToBuffer`. Isso fazia a retomada devolver apenas a cauda do arquivo (o
 * prefixo baixado antes tinha sido perdido), o hash nao fechar, e o download inteiro acontecer
 * de novo. A retomada nunca retomava, e nada falhava de forma visivel.
 *
 * `onupgradeneeded` so cria o store que falta, entao subir de 1 para 2 nao apaga o manifesto em
 * cache nem os offsets existentes.
 */
const DB_VERSION = 2;
const STORE_PROGRESS = 'downloadProgress';
const STORE_MANIFEST = 'manifestCache';
const STORE_CHUNKS = 'downloadChunks';

/**
 * IndexedDB persistence for resumable download bytes, byte offsets and last manifest JSON.
 * Falls back to in-memory maps when IndexedDB is unavailable (SSR/tests).
 */
@Injectable()
export class DownloadProgressIdbService {
  private readonly platformId = inject(PLATFORM_ID);
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly memoryOffsets = new Map<string, number>();
  private readonly memoryChunks = new Map<string, ArrayBuffer[]>();
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
          if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
            db.createObjectStore(STORE_CHUNKS);
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

  /**
   * Pedacos ja baixados, em ordem. Vetor vazio quando nao ha nada guardado.
   *
   * `ArrayBuffer[]` e nao um `Blob` unico. `Blob` guardaria os bytes em disco sem ocupar a
   * memoria do WebView, o que seria melhor — mas `new Blob([outroBlob, pedaco])` nao concatena
   * no jsdom (a parte vira a string `"[object Blob]"`), e teste que nao roda nao protege nada.
   *
   * O custo e pequeno no desenho atual: `downloadToBuffer` devolve `ArrayBuffer`, entao o
   * arquivo inteiro passa pela memoria no fim de qualquer forma. O ganho real sobre o codigo
   * anterior e que a **acumulacao entre tentativas** vai para o disco, em vez de morrer num
   * vetor local. Baixar direto para arquivo e o item 3 da Frente F, fora do escopo aqui.
   */
  async getPartial(mediaId: string): Promise<ArrayBuffer[]> {
    const db = await this.openDb();
    if (!db) {
      return this.memoryChunks.get(mediaId) ?? [];
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const req = tx.objectStore(STORE_CHUNKS).get(mediaId);
      req.onerror = (): void => reject(req.error);
      req.onsuccess = (): void => {
        const v = req.result as ArrayBuffer[] | undefined;
        resolve(Array.isArray(v) ? v : []);
      };
    });
  }

  /**
   * Acrescenta um pedaco e devolve o total de bytes guardados.
   *
   * O total devolvido e a **unica** fonte de verdade do offset. Devolver o que o banco de fato
   * tem evita o estado em que o offset gravado aponta para alem dos bytes guardados (queda
   * entre as duas escritas), que faria o pedido seguinte pular um trecho e montar um arquivo
   * corrompido que so o hash pegaria — depois de baixar tudo.
   */
  async appendPartial(mediaId: string, chunk: ArrayBuffer): Promise<number> {
    const anteriores = await this.getPartial(mediaId);
    const combinado = [...anteriores, chunk];
    const total = combinado.reduce((a, p) => a + p.byteLength, 0);

    const db = await this.openDb();
    if (!db) {
      this.memoryChunks.set(mediaId, combinado);
      this.memoryOffsets.set(mediaId, total);
      return total;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      tx.objectStore(STORE_CHUNKS).put(combinado, mediaId);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
    });
    await this.setDownloadOffset(mediaId, total);
    return total;
  }

  /** Apaga bytes e offset juntos. Os dois descrevem o mesmo download. */
  async clearPartial(mediaId: string): Promise<void> {
    this.memoryChunks.delete(mediaId);
    await this.clearDownloadOffset(mediaId);
    const db = await this.openDb();
    if (!db) {
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      tx.objectStore(STORE_CHUNKS).delete(mediaId);
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
    this.memoryChunks.clear();
    this.memoryManifest = null;
  }
}
