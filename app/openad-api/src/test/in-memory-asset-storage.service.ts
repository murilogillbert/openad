import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';

/**
 * In-process storage for Jest integration tests (no Cloudflare credentials).
 * Same `r2:{key}` shape as {@link AssetStorageService}.
 */
@Injectable()
export class InMemoryAssetStorageService {
  private readonly store = new Map<string, Buffer>();

  async saveCreativeAsset(params: {
    campaignId: string;
    assetId: string;
    safeFilename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<string> {
    void params.mimeType;
    const key = `${params.campaignId}/${params.assetId}/${params.safeFilename}`;
    return this.putObjectAtKey(key, params.buffer, params.mimeType);
  }

  async putObjectAtKey(
    key: string,
    body: Buffer,
    _contentType: string
  ): Promise<string> {
    void _contentType;
    const url = `r2:${key}`;
    this.store.set(url, Buffer.from(body));
    return url;
  }

  async getPresignedPutObjectUrl(params: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    void params.expiresInSeconds;
    void params.contentType;
    return `memory:put:${encodeURIComponent(params.key)}`;
  }

  async headObjectKey(key: string): Promise<{
    contentLength: number;
    etag?: string;
  } | null> {
    const url = `r2:${key}`;
    const buf = this.store.get(url);
    if (!buf) {
      return null;
    }
    return { contentLength: buf.length, etag: '"memory"' };
  }

  async deleteObjectByRef(storageUrl: string): Promise<void> {
    this.store.delete(storageUrl);
  }

  /**
   * Integration tests: register bytes for a `memory:...` URL so {@link getPresignedGetUrl} works
   * when Mongo rows point at synthetic storage URLs without a full upload path.
   */
  seedStorageUrl(
    storageUrl: string,
    body: Buffer = Buffer.from('test-bytes')
  ): void {
    this.store.set(storageUrl, body);
  }

  async getPresignedGetUrl(
    storageUrl: string,
    _expiresInSeconds?: number
  ): Promise<string> {
    void _expiresInSeconds;
    if (!this.store.has(storageUrl)) {
      throw new Error(`in-memory object missing: ${storageUrl}`);
    }
    return `https://memory.test/get?k=${encodeURIComponent(storageUrl)}`;
  }

  async openReadStream(storageUrl: string): Promise<Readable> {
    const buf = this.store.get(storageUrl);
    if (!buf) {
      throw new Error(`in-memory asset missing: ${storageUrl}`);
    }
    return Readable.from(buf);
  }

  async readBuffer(storageUrl: string): Promise<Buffer> {
    const buf = this.store.get(storageUrl);
    if (!buf) {
      throw new Error(`in-memory asset missing: ${storageUrl}`);
    }
    return Buffer.from(buf);
  }

  async readBufferFromKey(key: string): Promise<Buffer> {
    return this.readBuffer(`r2:${key}`);
  }
}
