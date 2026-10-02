import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { MediaIngestionController } from './media-ingestion.controller';
import { MediaVfsUploadController } from './media-vfs-upload.controller';
import { MediaFoldersController } from './media-folders.controller';
import { MediaVfsAssetsController } from './media-vfs-assets.controller';
import { MediaIngestionService } from './media-ingestion.service';
import { HashGeneratorService } from './validators/hash-generator.service';
import { VideoValidatorService } from './validators/video-validator.service';
import { MediaAsset, MediaAssetSchema } from './schemas/media-asset.schema';
import { FolderNode, FolderNodeSchema } from './schemas/folder-node.schema';
import { UploadSession, UploadSessionSchema } from './schemas/upload-session.schema';
import { UploadSessionService } from './upload-session.service';
import { MediaScopeService } from './media-scope.service';
import { MediaGcService } from './media-gc.service';
import { DoohRulesService } from './dooh-rules.service';
import { FolderService } from './folder.service';
import { MediaVfsBootstrapService } from './media-vfs-bootstrap.service';
import { MediaFolderProvisioningService } from './media-folder-provisioning.service';
import { UploadSessionCleanupJob } from './jobs/upload-session-cleanup.job';
import { DoohMediaRevalidationJob } from './jobs/dooh-media-revalidation.job';
import { PlatformConfigModule } from '../platform-config/platform-config.module';

@Module({
  imports: [
    PlatformConfigModule,
    AssetStorageModule,
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
      { name: FolderNode.name, schema: FolderNodeSchema },
      { name: UploadSession.name, schema: UploadSessionSchema },
    ]),
  ],
  controllers: [
    MediaIngestionController,
    MediaVfsUploadController,
    MediaFoldersController,
    MediaVfsAssetsController,
  ],
  providers: [
    MediaIngestionService,
    VideoValidatorService,
    HashGeneratorService,
    UploadSessionService,
    MediaScopeService,
    MediaGcService,
    DoohRulesService,
    FolderService,
    MediaVfsBootstrapService,
    MediaFolderProvisioningService,
    UploadSessionCleanupJob,
    DoohMediaRevalidationJob,
  ],
  exports: [
    MediaIngestionService,
    UploadSessionService,
    MediaFolderProvisioningService,
    MongooseModule,
  ],
})
export class MediaIngestionModule {}
