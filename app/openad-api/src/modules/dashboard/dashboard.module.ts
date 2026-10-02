import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { FleetMonitorModule } from '../fleet-monitor/fleet-monitor.module';
import { ImpressionsModule } from '../impressions/impressions.module';
import { MediaAsset, MediaAssetSchema } from '../media-ingestion/schemas/media-asset.schema';
import { ReportJobRecord, ReportJobSchema } from '../reporting/report-job.schema';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { DashboardService } from './dashboard.service';

/** Provides {@link DashboardService}; HTTP routes are registered on {@link FleetMonitorModule}. */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => FleetMonitorModule),
    CampaignsModule,
    ImpressionsModule,
    PlatformConfigModule,
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
      { name: ReportJobRecord.name, schema: ReportJobSchema },
    ]),
  ],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
