import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { Campaign, CampaignSchema } from './campaign.schema';
import { CreativeAsset, CreativeAssetSchema } from './creative-asset.schema';
import { CampaignsRepository } from './campaigns.repository';
import { CreativeAssetsRepository } from './creative-assets.repository';
import { CampaignLifecycleService } from './campaign-lifecycle.service';
import { CampaignReadinessService } from './campaign-readiness.service';
import { AssetUploadService } from './asset-upload.service';
import { AssetIntegrityService } from './asset-integrity.service';
import { AssetIntegrityWorker } from './asset-integrity.worker';
import { AssetUrlService } from './asset-url.service';
import { AssetDownloadGuard } from './guards/asset-download.guard';
import { CampaignsController } from './campaigns.controller';
import { ScheduleRulesModule } from '../schedule-rules/schedule-rules.module';
import { GeoZonesModule } from '../geo-zones/geo-zones.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { MediaIngestionModule } from '../media-ingestion/media-ingestion.module';

@Module({
  imports: [
    AssetStorageModule,
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: CreativeAsset.name, schema: CreativeAssetSchema },
    ]),
    forwardRef(() => ScheduleRulesModule),
    GeoZonesModule,
    forwardRef(() => VehiclesModule),
    MediaIngestionModule,
  ],
  controllers: [CampaignsController],
  providers: [
    CampaignsRepository,
    CreativeAssetsRepository,
    CampaignLifecycleService,
    CampaignReadinessService,
    AssetUploadService,
    AssetIntegrityService,
    AssetIntegrityWorker,
    AssetUrlService,
    AssetDownloadGuard,
  ],
  exports: [
    CampaignsRepository,
    CreativeAssetsRepository,
    CampaignReadinessService,
    AssetUrlService,
    MongooseModule,
  ],
})
export class CampaignsModule {}
