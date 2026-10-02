import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { GeoZonesModule } from '../geo-zones/geo-zones.module';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { MediaIngestionModule } from '../media-ingestion/media-ingestion.module';
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
  ],
  controllers: [ManifestController],
  providers: [
    ManifestService,
    ManifestGeneratorService,
    SpatialManifestBuilderService,
    DeltaCalculatorService,
    ManifestDeviceJwtGuard,
  ],
  exports: [ManifestService],
})
export class ManifestModule {}
