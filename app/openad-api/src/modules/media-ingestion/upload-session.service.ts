import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import 'multer';
import type { Express } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import {
  uploadSessionInitRequestSchema,
  type UploadSessionInitResponse,
} from '@openad/api-contracts';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import { UploadSession, UploadSessionDocument } from './schemas/upload-session.schema';
const DEFAULT_TTL_SEC = 3600;
const DEFAULT_ALLOWED_MIME = ['video/mp4', 'image/jpeg', 'image/png'] as const;

@Injectable()
export class UploadSessionService {
  constructor(
    @InjectModel(UploadSession.name)
    private readonly uploadSessionModel: Model<UploadSessionDocument>,
    private readonly platform: PlatformConfigRuntimeService,
    private readonly assets: AssetStorageService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(UploadSessionService.name);
  }

  private tenantPrefix(): string {
    return (
      (process.env.MEDIA_VFS_TENANT_KEY_PREFIX ?? '').trim() || 'openad'
    );
  }

  private maxBytes(): number {
    return this.platform.get().mediaLimits.maxVideoBytes;
  }

  private ttlSeconds(): number {
    const raw = (process.env.MEDIA_UPLOAD_SESSION_TTL_SECONDS ?? '').trim();
    if (!raw) {
      return DEFAULT_TTL_SEC;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
  }

  private allowedMimeTypes(): string[] {
    const raw = (process.env.MEDIA_ALLOWED_MIME_TYPES ?? '').trim();
    if (!raw?.trim()) {
      return [...DEFAULT_ALLOWED_MIME];
    }
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private safeFilename(name: string): string {
    return name.replace(/[^\w.-]/g, '_').slice(0, 200) || 'upload.bin';
  }

  async createSession(
    body: unknown,
    initiatedBy: string
  ): Promise<UploadSessionInitResponse> {
    const parsed = uploadSessionInitRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_BODY',
          message: 'Invalid upload session init',
          details: parsed.error.flatten(),
        },
      });
    }
    const { filename, contentType, campaignIds, folderId, campaignId } =
      parsed.data;
    const allowed = this.allowedMimeTypes();
    if (!allowed.includes(contentType)) {
      throw new BadRequestException({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `contentType must be one of: ${allowed.join(', ')}`,
        },
      });
    }

    const sessionId = randomUUID();
    const prefix = this.tenantPrefix();
    const safeName = this.safeFilename(filename);
    const storageKey = `${prefix}/vfs/${sessionId}/${safeName}`;
    const ttl = this.ttlSeconds();
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const maxBytes = this.maxBytes();

    await this.uploadSessionModel.create({
      sessionId,
      storageKey,
      tenantKeyPrefix: prefix,
      initiatedBy,
      contentType,
      originalFilename: filename,
      targetFolderId: folderId ?? null,
      targetCampaignId: campaignId ?? null,
      allowedCampaignIds: campaignIds ?? [],
      maxBytes,
      allowedMimeTypes: allowed,
      expiresAt,
      status: 'initiated',
    });

    void this.logger.info(
      { sessionId, storageKey, initiatedBy },
      'upload session created'
    );

    return {
      sessionId,
      storageKey,
      tenantKeyPrefix: prefix,
      expiresAt: expiresAt.toISOString(),
      maxBytes,
    };
  }

  /**
   * Verifies the uploaded object exists and matches policy. Does **not** mark the session completed.
   */
  async verifySessionForCatalog(
    sessionId: string,
    initiatedBy: string
  ): Promise<{
    session: UploadSessionDocument;
    verifiedContentLength: number;
  }> {
    const session = await this.uploadSessionModel
      .findOne({ sessionId })
      .exec();
    if (!session) {
      throw new NotFoundException({
        error: { code: 'SESSION_NOT_FOUND', message: sessionId },
      });
    }
    if (session.initiatedBy !== initiatedBy) {
      throw new ForbiddenException({
        error: { code: 'SESSION_FORBIDDEN', message: 'Not your upload session' },
      });
    }
    if (session.status !== 'initiated') {
      throw new BadRequestException({
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: `Session is ${session.status}`,
        },
      });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await this.uploadSessionModel
        .updateOne({ sessionId }, { $set: { status: 'expired' } })
        .exec()
        .catch(() => undefined);
      throw new BadRequestException({
        error: { code: 'SESSION_EXPIRED', message: sessionId },
      });
    }

    const head = await this.assets.headObjectKey(session.storageKey);
    if (!head) {
      throw new BadRequestException({
        error: {
          code: 'OBJECT_NOT_FOUND',
          message:
            'Storage object missing; upload bytes via POST …/uploads/:sessionId/proxy first',
        },
      });
    }
    if (head.contentLength > session.maxBytes) {
      throw new BadRequestException({
        error: {
          code: 'OBJECT_TOO_LARGE',
          message: `Object size ${head.contentLength} exceeds max ${session.maxBytes}`,
        },
      });
    }

    void this.logger.info(
      { sessionId, verifiedContentLength: head.contentLength },
      'upload session storage verified'
    );

    return { session, verifiedContentLength: head.contentLength };
  }

  async markSessionCompleted(sessionId: string): Promise<void> {
    await this.uploadSessionModel
      .updateOne({ sessionId }, { $set: { status: 'completed' } })
      .exec();
  }

  /**
   * Accept upload bytes on the API and store in object storage server-side (management clients
   * never receive storage credentials or presigned URLs).
   */
  async receiveProxiedUpload(
    sessionId: string,
    initiatedBy: string,
    file: Express.Multer.File
  ): Promise<void> {
    const session = await this.uploadSessionModel.findOne({ sessionId }).exec();
    if (!session) {
      throw new NotFoundException({
        error: { code: 'SESSION_NOT_FOUND', message: sessionId },
      });
    }
    if (session.initiatedBy !== initiatedBy) {
      throw new ForbiddenException({
        error: { code: 'SESSION_FORBIDDEN', message: 'Not your upload session' },
      });
    }
    if (session.status !== 'initiated') {
      throw new BadRequestException({
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: `Session is ${session.status}`,
        },
      });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await this.uploadSessionModel
        .updateOne({ sessionId }, { $set: { status: 'expired' } })
        .exec()
        .catch(() => undefined);
      throw new BadRequestException({
        error: { code: 'SESSION_EXPIRED', message: sessionId },
      });
    }
    if (file.size > session.maxBytes) {
      throw new BadRequestException({
        error: {
          code: 'OBJECT_TOO_LARGE',
          message: `Object size ${file.size} exceeds max ${session.maxBytes}`,
        },
      });
    }
    const m = file.mimetype?.toLowerCase() ?? '';
    const expected = session.contentType.toLowerCase();
    const mimeOk =
      m === expected ||
      m === 'application/octet-stream' ||
      m === '';
    if (!mimeOk) {
      throw new BadRequestException({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Expected ${session.contentType}, got ${file.mimetype}`,
        },
      });
    }

    await this.assets.putObjectAtKey(
      session.storageKey,
      file.buffer,
      session.contentType
    );
    void this.logger.info(
      { sessionId, storageKey: session.storageKey },
      'VFS upload bytes stored via API'
    );
  }
}
