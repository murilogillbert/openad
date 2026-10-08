import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { DevicesModule } from '../devices/devices.module';
import { GeoZonesModule } from '../geo-zones/geo-zones.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { MediaIngestionModule } from '../media-ingestion/media-ingestion.module';
import { MonetizationModule } from '../monetization/monetization.module';
import { CampaignEligibilityService } from './generators/campaign-eligibility.service';
import { TargetingMatcherService } from './generators/targeting-matcher.service';
import { DeltaCalculatorService } from './generators/delta-calculator.service';
import { ManifestGeneratorService } from './generators/manifest-generator.service';
import { SpatialManifestBuilderService } from './generators/spatial-manifest-builder.service';
import { ManifestDeviceJwtGuard } from './guards/manifest-device-jwt.guard';
import { ManifestController } from './manifest.controller';
import { ManifestService } from './manifest.service';
import {
  DeviceManifestSync,
  DeviceManifestSyncSchema,
} from './schemas/device-manifest-sync.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceManifestSync.name, schema: DeviceManifestSyncSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => DevicesModule),
    AssetStorageModule,
    MediaIngestionModule,
    GeoZonesModule,
    forwardRef(() => AnalyticsModule),
    forwardRef(() => CampaignsModule),
    // Segmentacao na entrega: o matcher resolve veiculo e zonas a partir do `deviceState`.
    VehiclesModule,
    PlatformConfigModule,
    // Portao de credito na elegibilidade: so entra no manifesto a campanha com reserva aberta.
    forwardRef(() => MonetizationModule),
  ],
  controllers: [ManifestController],
  providers: [
    ManifestService,
    ManifestGeneratorService,
    CampaignEligibilityService,
    TargetingMatcherService,
    SpatialManifestBuilderService,
    DeltaCalculatorService,
    ManifestDeviceJwtGuard,
  ],
  exports: [ManifestService],
})
export class ManifestModule {}
