import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

const R2_PREFIX = 'r2:' as const;

export function isR2StorageRef(ref: string): boolean {
  return typeof ref === 'string' && ref.startsWith(R2_PREFIX);
}

/**
 * Parse `r2:{key}` → key. Throws if ref is not an R2-style ref.
 */
export function storageKeyFromRef(storageUrl: string): string {
  if (!isR2StorageRef(storageUrl)) {
    throw new Error(`Expected r2: storage ref, got: ${storageUrl}`);
  }
  return storageUrl.slice(R2_PREFIX.length);
}

/**
 * S3-compatible object storage (AWS S3, MinIO, Cloudflare R2).
 * Persisted refs use `r2:{key}` (historical name; works with any S3 backend).
 *
 * Media library previews: {@link getPresignedGetUrl} → `previewUrl` on list/detail
 * (see {@link MediaIngestionService.withPreviewUrls}).
 */
@Injectable()
export class AssetStorageService {
  private readonly client: S3Client;
  /**
   * Cliente usado **só para assinar URL**, apontado para o endereço público do storage.
   *
   * Por que dois clientes: a assinatura SigV4 inclui o host, então uma URL assinada com o
   * endpoint interno (`http://hub-minio:9000`) só é válida naquele host — e quem consome URL
   * pré-assinada está sempre **fora** da rede Docker. O tablet no carro recebia
   * `http://hub-minio:9000/openad-media/…` no manifesto, não resolvia o nome, nenhum criativo
   * era baixado e nada tocava na tela; o `previewUrl` do portal tinha o mesmo defeito, no
   * navegador do operador.
   *
   * Upload e leitura de stream continuam no cliente interno: são servidor-a-servidor, e sair
   * pela internet para buscar o próprio arquivo seria mais lento e pagaria tráfego.
   *
   * Sem `S3_PUBLIC_ENDPOINT` definido, cai no cliente interno — mantém o comportamento
   * anterior em desenvolvimento, onde os dois endereços coincidem.
   */
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor() {
    const region = (process.env.S3_REGION ?? '').trim() || 'us-east-1';
    const endpoint = (process.env.S3_ENDPOINT ?? '').trim() || undefined;
    const forcePathStyle =
      (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true';
    const accessKeyId = (process.env.S3_ACCESS_KEY_ID ?? '').trim();
    const secretAccessKey =
      (process.env.S3_SECRET_ACCESS_KEY ?? '').trim();

    this.bucket = (process.env.S3_BUCKET ?? '').trim();
    if (!this.bucket) {
      throw new Error(
        'S3_BUCKET is required (even for MinIO/R2). Start via `pnpm api:serve` (dotenvx) or export S3_* env vars.'
      );
    }

    const clientConfig: S3ClientConfig = {
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    };
    if (endpoint) {
      clientConfig.endpoint = endpoint;
      clientConfig.forcePathStyle = forcePathStyle;
    }

    this.client = new S3Client(clientConfig);

    const publicEndpoint = (process.env.S3_PUBLIC_ENDPOINT ?? '').trim();
    if (publicEndpoint && publicEndpoint !== endpoint) {
      this.signingClient = new S3Client({
        ...clientConfig,
        endpoint: publicEndpoint,
        // O endereço público do MinIO serve por caminho (`/bucket/chave`), igual ao interno.
        forcePathStyle: endpoint ? forcePathStyle : true,
      });
    } else {
      this.signingClient = this.client;
    }
  }

  async saveCreativeAsset(params: {
    campaignId: string;
    assetId: string;
    safeFilename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<string> {
    const key = `${params.campaignId}/${params.assetId}/${params.safeFilename}`;
    return this.putObjectAtKey(key, params.buffer, params.mimeType);
  }

  async putObjectAtKey(
    key: string,
    body: Buffer,
    contentType: string
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    return `${R2_PREFIX}${key}`;
  }

  async getPresignedPutObjectUrl(params: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    return getSignedUrl(this.client, cmd, {
      expiresIn: params.expiresInSeconds,
    });
  }

  async headObjectKey(key: string): Promise<{
    contentLength: number;
    etag?: string;
  } | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      const len = out.ContentLength;
      if (len == null) {
        return null;
      }
      return {
        contentLength: len,
        etag: out.ETag,
      };
    } catch (e: unknown) {
      const meta =
        e && typeof e === 'object' && '$metadata' in e
          ? (e as { $metadata?: { httpStatusCode?: number } }).$metadata
          : undefined;
      const status = meta?.httpStatusCode;
      const name =
        e && typeof e === 'object' && 'name' in e
          ? String((e as { name: string }).name)
          : '';
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return null;
      }
      throw e;
    }
  }

  async deleteObjectByRef(storageUrl: string): Promise<void> {
    const key = storageKeyFromRef(storageUrl);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async getPresignedGetUrl(
    storageUrl: string,
    expiresInSeconds = 3600
  ): Promise<string> {
    const key = storageKeyFromRef(storageUrl);
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    // `signingClient`, não `client`: quem abre esta URL está fora da rede Docker.
    return getSignedUrl(this.signingClient, cmd, { expiresIn: expiresInSeconds });
  }

  async openReadStream(storageUrl: string): Promise<Readable> {
    const key = storageKeyFromRef(storageUrl);
    const out = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    if (!out.Body) {
      throw new Error(`S3 GetObject empty body: ${key}`);
    }
    return out.Body as Readable;
  }

  async readBuffer(storageUrl: string): Promise<Buffer> {
    const stream = await this.openReadStream(storageUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async readBufferFromKey(key: string): Promise<Buffer> {
    return this.readBuffer(`${R2_PREFIX}${key}`);
  }
}
