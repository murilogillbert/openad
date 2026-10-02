import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { FolderNode, FolderNodeDocument } from './schemas/folder-node.schema';

/**
 * Idempotent seed for `/Root/...` skeleton (T013). Safe to run on every startup.
 */
@Injectable()
export class MediaVfsBootstrapService implements OnModuleInit {
  constructor(
    @InjectModel(FolderNode.name)
    private readonly folderModel: Model<FolderNodeDocument>,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(MediaVfsBootstrapService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureSystemFolders();
  }

  private async upsert(params: {
    materializedPath: string;
    parentId: string | null;
    name: string;
    isSystemLocked: boolean;
  }): Promise<FolderNodeDocument> {
    const existing = await this.folderModel
      .findOne({ materializedPath: params.materializedPath })
      .exec();
    if (existing) {
      return existing;
    }
    const doc = await this.folderModel.create({
      name: params.name,
      parentId: params.parentId,
      materializedPath: params.materializedPath,
      campaignId: null,
      isSystemLocked: params.isSystemLocked,
    });
    void this.logger.info(
      { materializedPath: params.materializedPath, id: doc._id.toString() },
      'vfs folder seeded'
    );
    return doc;
  }

  async ensureSystemFolders(): Promise<void> {
    const root = await this.upsert({
      materializedPath: '/Root',
      parentId: null,
      name: 'Root',
      isSystemLocked: true,
    });
    const defaults = await this.upsert({
      materializedPath: '/Root/Defaults',
      parentId: root._id.toString(),
      name: 'Defaults',
      isSystemLocked: true,
    });
    await this.upsert({
      materializedPath: '/Root/Defaults/Global_Ads',
      parentId: defaults._id.toString(),
      name: 'Global_Ads',
      isSystemLocked: true,
    });
    await this.upsert({
      materializedPath: '/Root/Defaults/System_Assets',
      parentId: defaults._id.toString(),
      name: 'System_Assets',
      isSystemLocked: true,
    });
    await this.upsert({
      materializedPath: '/Root/Campaigns',
      parentId: root._id.toString(),
      name: 'Campaigns',
      isSystemLocked: true,
    });
  }
}
