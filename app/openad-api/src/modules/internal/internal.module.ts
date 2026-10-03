import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { MediaIngestionModule } from '../media-ingestion/media-ingestion.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import {
  PlayRecord,
  PlayRecordSchema,
} from '../analytics/schemas/play-record.schema';
import {
  MediaAsset,
  MediaAssetSchema,
} from '../media-ingestion/schemas/media-asset.schema';
import { AccountPurgeService } from './account-purge.service';
import { AdPayoutsReportService } from './ad-payouts-report.service';
import { DriverEarningClient } from './driver-earning.client';
import { InternalController } from './internal.controller';
import { ServiceApiKeyGuard } from './service-api-key.guard';

/**
 * Superfície servico-a-servico do openad.
 *
 * Exporta o `DriverEarningClient` porque o módulo de analytics precisa dele: o crédito do
 * repasse acontece no instante em que a veiculação vira faturável, dentro do processador de
 * reconciliação. As outras peças ficam internas — são só borda.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlayRecord.name, schema: PlayRecordSchema },
      { name: MediaAsset.name, schema: MediaAssetSchema },
    ]),
    CampaignsModule,
    MediaIngestionModule,
    VehiclesModule,
    PlatformConfigModule,
  ],
  controllers: [InternalController],
  providers: [
    ServiceApiKeyGuard,
    AccountPurgeService,
    AdPayoutsReportService,
    DriverEarningClient,
  ],
  exports: [DriverEarningClient],
})
export class InternalModule {}
