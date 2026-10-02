import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Response } from 'express';
import type {
  BillingReportResponse,
  ImpressionEventDetail,
  ReportJobStatus,
} from '@openad/api-contracts';
import {
  AssetStorageService,
  isR2StorageRef,
} from '../../infrastructure/storage/asset-storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ImpressionEventsRepository } from '../impressions/impression-events.repository';
import { BillingReportService } from './billing-report.service';
import { ProofOfPlayDto } from './dto/proof-of-play.dto';
import { ReportJobsRepository } from './report-jobs.repository';
import { ReportingService } from './reporting.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly billingReports: BillingReportService,
    private readonly impressions: ImpressionEventsRepository,
    private readonly reportJobs: ReportJobsRepository,
    private readonly storage: AssetStorageService
  ) {}

  @Post('proof-of-play')
  @Throttle({ reports: { limit: 5, ttl: 60_000 } })
  @HttpCode(201)
  @Roles('finance_analyst', 'fleet_admin', 'super_admin')
  requestProofOfPlay(
    @Body() dto: ProofOfPlayDto,
    @Req() req: Request
  ) {
    const u = req.user as { userId?: string } | undefined;
    return this.reporting.requestProofOfPlay(dto, u?.userId ?? null);
  }

  @Get('billing')
  @Roles('finance_analyst', 'fleet_admin', 'super_admin')
  async getBilling(
    @Query('from') from: string,
    @Query('to') to: string
  ): Promise<BillingReportResponse> {
    if (!from || !to) {
      throw new BadRequestException({
        code: 'BAD_QUERY',
        message: 'from and to (ISO date) are required',
      });
    }
    return this.billingReports.getBilling(new Date(from), new Date(to));
  }

  @Get('impressions/:eventId')
  @Roles('finance_analyst', 'fleet_admin', 'super_admin')
  async impressionDetail(
    @Param('eventId') eventId: string
  ): Promise<ImpressionEventDetail> {
    const doc = await this.impressions.findByEventId(eventId);
    if (!doc) {
      throw new NotFoundException({ code: 'IMPRESSION_NOT_FOUND', message: eventId });
    }
    const [lng, lat] = doc.location.coordinates;
    return {
      eventId: doc.eventId,
      deviceId: doc.deviceId,
      vehicleId: doc.vehicleId,
      campaignId: doc.campaignId,
      scheduleRuleId: doc.scheduleRuleId,
      assetId: doc.assetId,
      playedAt: doc.playedAt.toISOString(),
      receivedAt: doc.receivedAt.toISOString(),
      durationPlayedSeconds: doc.durationPlayedSeconds,
      location: {
        lat: lat ?? null,
        lng: lng ?? null,
        accuracyMeters: doc.accuracyMeters,
      },
      locationVerified: doc.locationVerified,
      billingValue: doc.billingValue,
      currency: doc.currency,
    };
  }

  @Get(':jobId/download')
  @Roles('finance_analyst', 'fleet_admin', 'super_admin')
  async download(
    @Param('jobId') jobId: string,
    @Res({ passthrough: false }) res: Response
  ): Promise<void> {
    const job = await this.reportJobs.findByJobId(jobId);
    if (!job || job.status !== 'ready' || !job.filePath) {
      throw new NotFoundException({ code: 'REPORT_NOT_READY', message: jobId });
    }

    if (!isR2StorageRef(job.filePath)) {
      throw new NotFoundException({ code: 'REPORT_NOT_READY', message: jobId });
    }

    const url = await this.storage.getPresignedGetUrl(job.filePath, 3600);
    res.redirect(302, url);
  }

  @Get(':jobId')
  @Roles('finance_analyst', 'fleet_admin', 'super_admin')
  getJob(@Param('jobId') jobId: string): Promise<ReportJobStatus> {
    return this.reporting.getJobStatus(jobId);
  }
}
