import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { AppRelease, AppReleaseSchema } from './schemas/app-release.schema';
import {
  ReleasePublication,
  ReleasePublicationSchema,
} from './schemas/release-publication.schema';
import { RolloutRecord, RolloutSchema } from './schemas/rollout.schema';
import {
  ReleaseAuditEvent,
  ReleaseAuditEventSchema,
} from './schemas/release-audit-event.schema';
import { ReleaseAuditService } from './services/release-audit.service';
import { ReleasePublicationService } from './services/release-publication.service';
import { ReleasesService } from './services/releases.service';
import { ReleasesStorageService } from './services/releases-storage.service';
import { ReleasesUrlService } from './services/releases-url.service';
import { RolloutEligibilityService } from './services/rollout-eligibility.service';
import { ReleasesAdminController } from './releases-admin.controller';
import { ReleasesArtifactController } from './releases-artifact.controller';
import { ReleasesCommandController } from './releases-command.controller';
import { ReleasesDeviceController } from './releases-device.controller';
import { ReleasesManifestController } from './releases-manifest.controller';
import { ReleasesPortalController } from './releases-portal.controller';

@Module({
  imports: [
    AssetStorageModule,
    AuthModule,
    DevicesModule,
    MongooseModule.forFeature([
      { name: AppRelease.name, schema: AppReleaseSchema },
      { name: ReleasePublication.name, schema: ReleasePublicationSchema },
      { name: RolloutRecord.name, schema: RolloutSchema },
      { name: ReleaseAuditEvent.name, schema: ReleaseAuditEventSchema },
    ]),
  ],
  controllers: [
    ReleasesAdminController,
    ReleasesPortalController,
    ReleasesManifestController,
    ReleasesArtifactController,
    ReleasesDeviceController,
    ReleasesCommandController,
  ],
  providers: [
    ReleasesStorageService,
    ReleasesUrlService,
    ReleaseAuditService,
    ReleasePublicationService,
    RolloutEligibilityService,
    ReleasesService,
  ],
  exports: [ReleasesService, ReleasesUrlService],
})
export class ReleasesModule {}
