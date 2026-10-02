import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { DevicesModule } from '../devices/devices.module';
import { GeoZonesModule } from '../geo-zones/geo-zones.module';
import { MediaAsset, MediaAssetSchema } from '../media-ingestion/schemas/media-asset.schema';
import { QueuesModule } from '../../infrastructure/queues/queues.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { AnalyticsReportingController } from './analytics-reporting.controller';
import { PacingSignalController } from './pacing-signal.controller';
import { AnalyticsReconciliationProcessor } from './processors/analytics-reconciliation.processor';
import {
  CampaignDailySpend,
  CampaignDailySpendSchema,
} from './schemas/campaign-daily-spend.schema';
import { PlayRecord, PlayRecordSchema } from './schemas/play-record.schema';
import { PlaybackBatchController } from './playback-batch.controller';
import { FraudDetectionService } from './services/fraud-detection.service';
import { PacingSignalService } from './services/pacing-signal.service';
import { PlaybackBatchIngestService } from './services/playback-batch-ingest.service';
import { ReconciliationService } from './services/reconciliation.service';
import { ReportingAggregationService } from './services/reporting-aggregation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlayRecord.name, schema: PlayRecordSchema },
      { name: MediaAsset.name, schema: MediaAssetSchema },
      { name: CampaignDailySpend.name, schema: CampaignDailySpendSchema },
    ]),
    QueuesModule,
    AuthModule,
    DevicesModule,
    GeoZonesModule,
    CampaignsModule,
    PlatformConfigModule,
  ],
  controllers: [
    PlaybackBatchController,
    AnalyticsReportingController,
    PacingSignalController,
  ],
  providers: [
    PlaybackBatchIngestService,
    ReconciliationService,
    ReportingAggregationService,
    FraudDetectionService,
    PacingSignalService,
    AnalyticsReconciliationProcessor,
  ],
  exports: [
    PlaybackBatchIngestService,
    ReconciliationService,
    ReportingAggregationService,
    FraudDetectionService,
    PacingSignalService,
  ],
})
export class AnalyticsModule {}
