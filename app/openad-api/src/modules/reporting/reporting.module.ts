import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { FleetMonitorModule } from '../fleet-monitor/fleet-monitor.module';
import { ImpressionsModule } from '../impressions/impressions.module';
import { BillingReportService } from './billing-report.service';
import { ObjectStorageCleanupService } from './object-storage-cleanup.service';
import { ReportGenerationWorker } from './report-generation.worker';
import { ReportJobRecord, ReportJobSchema } from './report-job.schema';
import { ReportJobsRepository } from './report-jobs.repository';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

@Module({
  imports: [
    AssetStorageModule,
    MongooseModule.forFeature([
      { name: ReportJobRecord.name, schema: ReportJobSchema },
    ]),
    CampaignsModule,
    ImpressionsModule,
    FleetMonitorModule,
  ],
  controllers: [ReportingController],
  providers: [
    ReportJobsRepository,
    ReportingService,
    BillingReportService,
    ReportGenerationWorker,
    ObjectStorageCleanupService,
  ],
  exports: [ReportingService],
})
export class ReportingModule {}
