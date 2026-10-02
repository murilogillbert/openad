import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import {
  createMediaFolderRequestSchema,
  patchMediaFolderRequestSchema,
} from '@openad/api-contracts';
import { FolderNode, FolderNodeDocument } from './schemas/folder-node.schema';

function slugSegment(name: string): string {
  const s = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return s.length > 0 ? s.slice(0, 120) : 'folder';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class FolderService {
  constructor(
    @InjectModel(FolderNode.name)
    private readonly folderModel: Model<FolderNodeDocument>,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(FolderService.name);
  }

  private toApi(node: FolderNodeDocument) {
    return {
      id: node._id.toString(),
      name: node.name,
      parentId: node.parentId,
      materializedPath: node.materializedPath,
      campaignId: node.campaignId,
      isSystemLocked: node.isSystemLocked,
    };
  }

  async findByMaterializedPath(path: string): Promise<FolderNodeDocument | null> {
    return this.folderModel.findOne({ materializedPath: path }).exec();
  }

  async listTree(): Promise<Array<ReturnType<FolderService['toApi']>>> {
    const rows = await this.folderModel.find({}).sort({ materializedPath: 1 }).exec();
    return rows.map((r) => this.toApi(r));
  }

  /**
   * Folders strictly under `scopeFolderId` (not the scope folder itself) whose name matches `q`.
   */
  async searchFoldersInSubtree(
    scopeFolderId: string,
    q: string
  ): Promise<Array<ReturnType<FolderService['toApi']>>> {
    const trimmed = q.trim();
    if (!trimmed) {
      return [];
    }
    const scope = await this.findFolderOrThrow(scopeFolderId);
    const nameRx = new RegExp(escapeRegex(trimmed), 'i');
    const pathEsc = escapeRegex(scope.materializedPath);
    const underScope = new RegExp(`^${pathEsc}\\/`);
    const rows = await this.folderModel
      .find({
        materializedPath: underScope,
        name: nameRx,
      })
      .sort({ name: 1 })
      .limit(75)
      .exec();
    return rows.map((r) => this.toApi(r));
  }

  /** All folder ids in the subtree rooted at `scopeFolderId`, including the scope folder. */
  async subtreeFolderIdsIncludingScope(scopeFolderId: string): Promise<string[]> {
    const scope = await this.findFolderOrThrow(scopeFolderId);
    const pathEsc = escapeRegex(scope.materializedPath);
    const inTree = new RegExp(`^${pathEsc}(\\/|$)`);
    const rows = await this.folderModel
      .find({ materializedPath: inTree })
      .select('_id')
      .lean()
      .exec();
    return rows.map((r) => String(r._id));
  }

  async listChildren(parentId: string | null, q?: string) {
    const filter: Record<string, unknown> = {
      parentId: parentId ?? null,
    };
    if (q?.trim()) {
      filter['name'] = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    const rows = await this.folderModel
      .find(filter)
      .sort({ name: 1 })
      .exec();
    return rows.map((r) => this.toApi(r));
  }

  /** Direct child folders only (not recursive). */
  async countDirectChildren(parentId: string): Promise<number> {
    return this.folderModel.countDocuments({ parentId }).exec();
  }

  async findFolderOrThrow(id: string): Promise<FolderNodeDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        error: { code: 'INVALID_ID', message: id },
      });
    }
    const doc = await this.folderModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException({
        error: { code: 'FOLDER_NOT_FOUND', message: id },
      });
    }
    return doc;
  }

  async createFolder(body: unknown, _userId: string) {
    void _userId;
    const parsed = createMediaFolderRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_BODY',
          message: 'Invalid folder create',
          details: parsed.error.flatten(),
        },
      });
    }
    const { parentId, name, campaignId } = parsed.data;
    const parent = await this.findFolderOrThrow(parentId);
    const seg = slugSegment(name);
    const materializedPath = `${parent.materializedPath}/${seg}`;
    if (!materializedPath.startsWith('/Root')) {
      throw new BadRequestException({
        error: { code: 'INVALID_PATH', message: 'Folders must live under /Root' },
      });
    }
    const exists = await this.folderModel
      .findOne({ materializedPath })
      .exec();
    if (exists) {
      throw new ConflictException({
        error: {
          code: 'FOLDER_EXISTS',
          message: materializedPath,
        },
      });
    }
    const doc = await this.folderModel.create({
      name,
      parentId: parentId ?? null,
      materializedPath,
      campaignId: campaignId ?? null,
      isSystemLocked: false,
    });
    void this.logger.info(
      { folderId: doc._id.toString(), materializedPath },
      'folder created'
    );
    return this.toApi(doc);
  }

  async patchFolder(id: string, body: unknown, _userId: string) {
    void _userId;
    const parsed = patchMediaFolderRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_BODY',
          message: 'Invalid folder patch',
          details: parsed.error.flatten(),
        },
      });
    }
    const doc = await this.findFolderOrThrow(id);
    if (doc.isSystemLocked) {
      throw new ForbiddenException({
        error: {
          code: 'SYSTEM_FOLDER_LOCKED',
          message: doc.materializedPath,
        },
      });
    }
    const nextName = parsed.data.name ?? doc.name;
    const nextParentId =
      parsed.data.parentId !== undefined ? parsed.data.parentId : doc.parentId;

    const curParent =
      doc.parentId === null || doc.parentId === undefined
        ? null
        : String(doc.parentId);
    if (nextName === doc.name && (nextParentId ?? null) === curParent) {
      return this.toApi(doc);
    }

    const parent =
      nextParentId === null
        ? null
        : await this.findFolderOrThrow(nextParentId);
    const seg = slugSegment(nextName);
    const materializedPath =
      nextParentId === null ? `/Root/${seg}` : `${parent!.materializedPath}/${seg}`;

    const clash = await this.folderModel
      .findOne({
        materializedPath,
        _id: { $ne: doc._id },
      })
      .exec();
    if (clash) {
      throw new ConflictException({
        error: { code: 'FOLDER_EXISTS', message: materializedPath },
      });
    }

    doc.name = nextName;
    doc.parentId = nextParentId;
    doc.materializedPath = materializedPath;
    if (parsed.data.campaignId !== undefined) {
      doc.campaignId = parsed.data.campaignId;
    }
    await doc.save();
    return this.toApi(doc);
  }

  async deleteFolderDocument(doc: FolderNodeDocument): Promise<void> {
    await this.folderModel.deleteOne({ _id: doc._id }).exec();
  }
}
