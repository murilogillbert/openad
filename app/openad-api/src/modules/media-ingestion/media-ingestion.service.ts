import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { PinoLogger } from 'nestjs-pino';
import {
  VideoCodec,
  cloneMediaAssetRequestSchema,
  patchMediaAssetRequestSchema,
  type UploadSessionCompleteResponse,
} from '@openad/api-contracts';
import {
  AssetStorageService,
  isR2StorageRef,
} from '../../infrastructure/storage/asset-storage.service';
import { MediaAsset, MediaAssetDocument } from './schemas/media-asset.schema';
import { HashGeneratorService } from './validators/hash-generator.service';
import { VideoValidatorService } from './validators/video-validator.service';
import type { UploadMediaDto } from './dto/upload-media.dto';
import { DoohRulesService } from './dooh-rules.service';
import { FolderService } from './folder.service';
import { UploadSessionService } from './upload-session.service';
import type { UploadSessionDocument } from './schemas/upload-session.schema';
import { MediaGcService } from './media-gc.service';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import { canonicalStorageKey } from './media-storage-key.util';
import type { FolderNodeDocument } from './schemas/folder-node.schema';

@Injectable()
export class MediaIngestionService {
  constructor(
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
    private readonly videoValidator: VideoValidatorService,
    private readonly hashGenerator: HashGeneratorService,
    private readonly assets: AssetStorageService,
    private readonly doohRules: DoohRulesService,
    private readonly folders: FolderService,
    private readonly uploadSessions: UploadSessionService,
    private readonly mediaGc: MediaGcService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(MediaIngestionService.name);
  }

  /**
   * Presigned VFS flow: verify storage → catalog row → mark session completed.
   */
  async completeVfsUpload(
    sessionId: string,
    userId: string
  ): Promise<UploadSessionCompleteResponse> {
    const { session, verifiedContentLength } =
      await this.uploadSessions.verifySessionForCatalog(sessionId, userId);
    try {
      const row = await this.registerVfsCatalog(session, verifiedContentLength);
      await this.uploadSessions.markSessionCompleted(sessionId);
      this.metrics.mediaVfsMutationsTotal.inc({ op: 'complete', outcome: 'ok' });
      return row;
    } catch (e) {
      if (e instanceof BadRequestException) {
        void this.logger.warn(
          { sessionId, response: e.getResponse() },
          'vfs catalog registration failed (object was already in storage)'
        );
      }
      throw e;
    }
  }

  private async resolvePlacementFolder(session: UploadSessionDocument): Promise<{
    folderId: string;
    campaignId?: string;
  }> {
    if (session.targetFolderId) {
      const f = await this.folders.findFolderOrThrow(session.targetFolderId);
      return {
        folderId: f._id.toString(),
        campaignId:
          session.targetCampaignId ?? (f.campaignId ?? undefined) ?? undefined,
      };
    }
    const globalAds = await this.folders.findByMaterializedPath(
      '/Root/Defaults/Global_Ads'
    );
    if (!globalAds) {
      throw new BadRequestException({
        error: {
          code: 'VFS_NOT_BOOTSTRAPPED',
          message: 'System folder /Root/Defaults/Global_Ads is missing',
        },
      });
    }
    return {
      folderId: globalAds._id.toString(),
      campaignId: session.targetCampaignId ?? undefined,
    };
  }

  private async registerVfsCatalog(
    session: UploadSessionDocument,
    verifiedContentLength: number
  ): Promise<UploadSessionCompleteResponse> {
    const buffer = await this.assets.readBufferFromKey(session.storageKey);
    if (buffer.length !== verifiedContentLength) {
      throw new BadRequestException({
        error: {
          code: 'SIZE_MISMATCH',
          message: 'Object size changed between head and read',
        },
      });
    }

    const hash = this.hashGenerator.sha256Buffer(buffer);
    if (this.doohRules.dedupEnabled()) {
      const existing = await this.mediaModel
        .findOne({ hash, isActive: true })
        .exec();
      if (existing) {
        return {
          success: true,
          storageKey: session.storageKey,
          verifiedContentLength,
          status: 'catalog_registered',
          mediaId: existing.mediaId,
          validationStatus: existing.validationStatus ?? 'approved',
          probeStatus: existing.probeStatus ?? 'complete',
          deduplicated: true,
          doohRulesetVersion: this.doohRules.getRulesetVersion(),
        };
      }
    }

    const mime = session.contentType;
    let meta: {
      bitrate: number;
      width: number;
      height: number;
      codec: VideoCodec;
      duration: number;
    };
    if (mime === 'video/mp4' || mime.startsWith('video/')) {
      meta = await this.videoValidator.validateVideoFromBuffer({
        buffer,
        byteLength: verifiedContentLength,
      });
    } else if (mime === 'image/jpeg' || mime === 'image/png') {
      meta = await this.videoValidator.validateImageFromBuffer({
        buffer,
        byteLength: verifiedContentLength,
      });
    } else {
      throw new BadRequestException({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Catalog registration not implemented for ${mime}`,
        },
      });
    }

    const placement = await this.resolvePlacementFolder(session);
    const mediaId = randomUUID();
    const storageUrl = `r2:${session.storageKey}`;

    await this.mediaModel.create({
      mediaId,
      hash,
      filename: session.originalFilename,
      fileSize: verifiedContentLength,
      bitrate: meta.bitrate,
      width: meta.width,
      height: meta.height,
      codec: this.codecToSchema(meta.codec),
      duration: meta.duration,
      categorization: 'universal',
      storageUrl,
      isActive: true,
      folderId: placement.folderId,
      campaignId: placement.campaignId,
      storageKey: session.storageKey,
      mimeType: mime,
      validationStatus: 'approved',
      probeStatus: 'complete',
      doohRulesetVersion: this.doohRules.getRulesetVersion(),
      uploadSessionId: session.sessionId,
      vfsSource: 'vfs_presign',
    });

    void this.logger.info(
      { mediaId, sessionId: session.sessionId, hash },
      'vfs catalog row created'
    );

    return {
      success: true,
      storageKey: session.storageKey,
      verifiedContentLength,
      status: 'catalog_registered',
      mediaId,
      validationStatus: 'approved',
      probeStatus: 'complete',
      deduplicated: false,
      doohRulesetVersion: this.doohRules.getRulesetVersion(),
    };
  }

  async listFolderAssets(params: {
    folderId: string;
    q?: string;
    page: number;
    limit: number;
  }) {
    const skip = (params.page - 1) * params.limit;
    const filter: Record<string, unknown> = {
      folderId: params.folderId,
      isActive: true,
    };
    if (params.q?.trim()) {
      const esc = params.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter['filename'] = new RegExp(esc, 'i');
    }
    const [rows, total] = await Promise.all([
      this.mediaModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(params.limit)
        .lean()
        .exec(),
      this.mediaModel.countDocuments(filter).exec(),
    ]);
    return {
      data: await this.withPreviewUrls(rows),
      pagination: { total, page: params.page, limit: params.limit },
    };
  }

  private async withPreviewUrls<T extends { storageUrl?: string }>(
    rows: T[]
  ): Promise<Array<T & { previewUrl: string | null }>> {
    return Promise.all(
      rows.map(async (r) => {
        const su = r.storageUrl;
        if (!su || !isR2StorageRef(su)) {
          return { ...r, previewUrl: null as string | null };
        }
        try {
          const url = await this.assets.getPresignedGetUrl(su, 900);
          return { ...r, previewUrl: url };
        } catch {
          return { ...r, previewUrl: null };
        }
      })
    );
  }

  /**
   * Recursive search: folder name matches under scope, and file name matches within scope subtree.
   */
  /**
   * Delete an empty leaf folder (no subfolders, no active placements). System folders are blocked.
   */
  async deleteVfsFolder(folderId: string): Promise<void> {
    const doc = await this.folders.findFolderOrThrow(folderId);
    if (doc.isSystemLocked) {
      throw new ForbiddenException({
        error: { code: 'SYSTEM_FOLDER', message: folderId },
      });
    }
    const subfolders = await this.folders.countDirectChildren(folderId);
    if (subfolders > 0) {
      throw new ConflictException({
        error: {
          code: 'FOLDER_HAS_SUBFOLDERS',
          message: 'Remove or move subfolders first',
        },
      });
    }
    const placed = await this.mediaModel
      .countDocuments({ folderId, isActive: true })
      .exec();
    if (placed > 0) {
      throw new ConflictException({
        error: {
          code: 'FOLDER_HAS_FILES',
          message: 'Remove or move files first',
        },
      });
    }
    await this.folders.deleteFolderDocument(doc);
  }

  async vfsSearch(scopeFolderId: string, q: string): Promise<{
    folders: Array<{
      id: string;
      name: string;
      parentId: string | null;
      materializedPath: string;
      campaignId: string | null;
      isSystemLocked: boolean;
    }>;
    files: unknown[];
  }> {
    const trimmed = q.trim();
    if (!trimmed) {
      return { folders: [], files: [] };
    }
    const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRx = new RegExp(esc, 'i');
    const [folders, folderIds] = await Promise.all([
      this.folders.searchFoldersInSubtree(scopeFolderId, trimmed),
      this.folders.subtreeFolderIdsIncludingScope(scopeFolderId),
    ]);
    const files = await this.mediaModel
      .find({
        folderId: { $in: folderIds },
        isActive: true,
        filename: nameRx,
      })
      .sort({ filename: 1 })
      .limit(75)
      .lean()
      .exec();
    return { folders, files: await this.withPreviewUrls(files) };
  }

  async countActiveRefsForCanonicalKey(key: string): Promise<number> {
    return this.mediaModel
      .countDocuments({
        isActive: true,
        $or: [{ storageKey: key }, { storageUrl: `r2:${key}` }],
      })
      .exec();
  }

  /**
   * Catalog row + shared-placement refcount (same S3 key / `r2:` key).
   */
  async getAssetDetail(mediaId: string) {
    const end = this.metrics.mediaVfsOperationSeconds.startTimer({
      op: 'get_detail',
    });
    try {
      const row = await this.mediaModel
        .findOne({ mediaId, isActive: true })
        .lean()
        .exec();
      if (!row) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: mediaId },
        });
      }
      const key = canonicalStorageKey(row);
      const referenceCount = key
        ? await this.countActiveRefsForCanonicalKey(key)
        : 1;
      let previewUrl: string | null = null;
      if (row.storageUrl && isR2StorageRef(row.storageUrl)) {
        try {
          previewUrl = await this.assets.getPresignedGetUrl(row.storageUrl, 3600);
        } catch {
          previewUrl = null;
        }
      }
      return { ...row, referenceCount, previewUrl };
    } finally {
      end();
    }
  }

  assertCampaignPlacement(
    sourceCampaignId: string | undefined | null,
    targetFolder: Pick<FolderNodeDocument, 'campaignId'>
  ): void {
    const s = sourceCampaignId ?? null;
    const t = targetFolder.campaignId ?? null;
    if (s && t && s !== t) {
      throw new ForbiddenException({
        error: {
          code: 'CAMPAIGN_SCOPE',
          message: 'Placement is not allowed across campaigns',
        },
      });
    }
  }

  async cloneVfsAsset(mediaId: string, body: unknown): Promise<{ mediaId: string }> {
    const end = this.metrics.mediaVfsOperationSeconds.startTimer({ op: 'clone' });
    try {
      const parsed = cloneMediaAssetRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException({
          error: {
            code: 'INVALID_BODY',
            message: 'Invalid clone payload',
            details: parsed.error.flatten(),
          },
        });
      }
      const source = await this.mediaModel
        .findOne({ mediaId, isActive: true })
        .exec();
      if (!source) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: mediaId },
        });
      }
      const targetFolder = await this.folders.findFolderOrThrow(
        parsed.data.targetFolderId
      );
      this.assertCampaignPlacement(source.campaignId, targetFolder);
      const newMediaId = randomUUID();
      const nextCampaign =
        targetFolder.campaignId ?? source.campaignId ?? undefined;
      await this.mediaModel.create({
        mediaId: newMediaId,
        hash: source.hash,
        filename: parsed.data.filename ?? source.filename,
        fileSize: source.fileSize,
        bitrate: source.bitrate,
        width: source.width,
        height: source.height,
        codec: source.codec,
        duration: source.duration,
        categorization: source.categorization,
        storageUrl: source.storageUrl,
        uploadedBy: source.uploadedBy,
        isActive: true,
        folderId: targetFolder._id.toString(),
        campaignId: nextCampaign,
        storageKey: source.storageKey,
        mimeType: source.mimeType,
        validationStatus: source.validationStatus,
        validationDetail: source.validationDetail,
        probeStatus: source.probeStatus,
        doohRulesetVersion: source.doohRulesetVersion,
        vfsSource: source.vfsSource ?? 'vfs_presign',
      });
      this.metrics.mediaVfsMutationsTotal.inc({ op: 'clone', outcome: 'ok' });
      void this.logger.info(
        { from: mediaId, to: newMediaId, targetFolder: parsed.data.targetFolderId },
        'media asset cloned'
      );
      return { mediaId: newMediaId };
    } catch (e) {
      this.metrics.mediaVfsMutationsTotal.inc({ op: 'clone', outcome: 'error' });
      throw e;
    } finally {
      end();
    }
  }

  async patchVfsAsset(mediaId: string, body: unknown) {
    const end = this.metrics.mediaVfsOperationSeconds.startTimer({ op: 'patch' });
    try {
      const parsed = patchMediaAssetRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException({
          error: {
            code: 'INVALID_BODY',
            message: 'Invalid patch payload',
            details: parsed.error.flatten(),
          },
        });
      }
      const doc = await this.mediaModel
        .findOne({ mediaId, isActive: true })
        .exec();
      if (!doc) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: mediaId },
        });
      }
      if (parsed.data.folderId) {
        const folder = await this.folders.findFolderOrThrow(parsed.data.folderId);
        this.assertCampaignPlacement(doc.campaignId, folder);
        doc.folderId = folder._id.toString();
        doc.campaignId = folder.campaignId ?? doc.campaignId;
      }
      if (parsed.data.filename) {
        doc.filename = parsed.data.filename;
      }
      await doc.save();
      this.metrics.mediaVfsMutationsTotal.inc({ op: 'patch', outcome: 'ok' });
      return doc.toObject();
    } catch (e) {
      this.metrics.mediaVfsMutationsTotal.inc({ op: 'patch', outcome: 'error' });
      throw e;
    } finally {
      end();
    }
  }

  async deleteVfsAsset(mediaId: string): Promise<void> {
    const end = this.metrics.mediaVfsOperationSeconds.startTimer({ op: 'delete' });
    try {
      const doc = await this.mediaModel
        .findOne({ mediaId, isActive: true })
        .exec();
      if (!doc) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: mediaId },
        });
      }
      const key = canonicalStorageKey(doc);
      await this.mediaModel
        .updateOne({ mediaId }, { $set: { isActive: false } })
        .exec();
      if (!key) {
        this.metrics.mediaVfsMutationsTotal.inc({ op: 'delete', outcome: 'ok' });
        return;
      }
      const remaining = await this.countActiveRefsForCanonicalKey(key);
      if (remaining === 0) {
        await this.mediaGc.deleteObjectIfOrphaned(key);
      }
      this.metrics.mediaVfsMutationsTotal.inc({ op: 'delete', outcome: 'ok' });
      void this.logger.info({ mediaId, storageKey: key, remaining }, 'media vfs delete');
    } catch (e) {
      this.metrics.mediaVfsMutationsTotal.inc({ op: 'delete', outcome: 'error' });
      throw e;
    } finally {
      end();
    }
  }

  async ingestUploadedFile(params: {
    tempPath: string;
    originalFilename: string;
    byteLength: number;
    dto: UploadMediaDto;
    uploadedBy?: string;
    /**
     * Dono do ativo — `public.users.id` quando quem sobe e anunciante, e `null` quando e a
     * equipe interna.
     *
     * Separado de `uploadedBy` de proposito: `uploadedBy` e auditoria de quem executou a acao,
     * `ownerUserId` e a regra de visibilidade. Um operador pode subir midia **por** um
     * anunciante, e nesse caso os dois valores diferem.
     */
    ownerUserId?: string | null;
  }): Promise<MediaAssetDocument> {
    const meta = await this.videoValidator.validateFile({
      filePath: params.tempPath,
      byteLength: params.byteLength,
    });

    const hash = await this.hashGenerator.sha256File(params.tempPath);
    const existing = await this.mediaModel.findOne({ hash }).exec();
    if (existing) {
      await fs.unlink(params.tempPath).catch(() => undefined);
      throw new ConflictException({
        error: {
          code: 'DUPLICATE_HASH',
          message: 'A media asset with this content hash already exists',
          details: { mediaId: existing.mediaId },
        },
      });
    }

    const mediaId = randomUUID();
    const ext = params.originalFilename.includes('.')
      ? params.originalFilename.slice(params.originalFilename.lastIndexOf('.'))
      : '.mp4';
    const key = `media/${mediaId}${ext}`;
    const buffer = await fs.readFile(params.tempPath);
    await fs.unlink(params.tempPath).catch(() => undefined);

    const storageUrl = await this.assets.putObjectAtKey(
      key,
      buffer,
      'video/mp4'
    );

    const doc = await this.mediaModel.create({
      mediaId,
      hash,
      filename: params.originalFilename,
      fileSize: params.byteLength,
      bitrate: meta.bitrate,
      width: meta.width,
      height: meta.height,
      codec: this.codecToSchema(meta.codec),
      duration: meta.duration,
      categorization: 'universal',
      storageUrl,
      uploadedBy: params.uploadedBy,
      ownerUserId: params.ownerUserId ?? null,
      isActive: true,
    });

    void this.logger.info({ mediaId, hash }, 'media ingested');
    return doc;
  }

  private codecToSchema(c: VideoCodec): 'h264' | 'h265' {
    return c === VideoCodec.H265 ? 'h265' : 'h264';
  }

  /**
   * Catalogo de midia, **sempre** escopado.
   *
   * `scope` vem de `ownerFilterFor`: `{}` para equipe interna e `{ ownerUserId }` para
   * anunciante. O filtro entra na consulta e na contagem, nao depois: escopar em memoria faria
   * a primeira pagina de um parceiro vir vazia porque foi preenchida com registros de outro e
   * descartada, e o total seria o de todo mundo.
   */
  async listCatalog(params: {
    page: number;
    limit: number;
    scope?: Record<string, unknown>;
  }) {
    const skip = (params.page - 1) * params.limit;
    const filtro = { isActive: true, ...(params.scope ?? {}) };
    const [rows, total] = await Promise.all([
      this.mediaModel
        .find(filtro)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(params.limit)
        .lean()
        .exec(),
      this.mediaModel.countDocuments(filtro).exec(),
    ]);
    return {
      data: rows,
      pagination: { total, page: params.page, limit: params.limit },
    };
  }

  /**
   * Detalhe de um ativo, escopado pelo dono.
   *
   * Ativo de outro parceiro responde **404, nao 403**, e isso e deliberado: "existe, mas nao e
   * seu" revela que o ativo existe, e com um identificador em maos daria para enumerar o
   * catalogo alheio. Para quem nao e dono, o recurso simplesmente nao existe.
   */
  async getById(mediaId: string, scope: Record<string, unknown> = {}) {
    const row = await this.mediaModel
      .findOne({ mediaId, ...scope })
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: mediaId } });
    }
    return row;
  }

  /** Exclusao logica, escopada pelo dono. Mesma regra de 404 do `getById`. */
  async softDelete(
    mediaId: string,
    scope: Record<string, unknown> = {}
  ): Promise<void> {
    const res = await this.mediaModel
      .updateOne({ mediaId, ...scope }, { $set: { isActive: false } })
      .exec();
    if (res.matchedCount === 0) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: mediaId } });
    }
  }
}
