import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import type {
  ProofOfPlayRequest,
  ReportJobAccepted,
  ReportJobStatus,
} from '@openad/api-contracts';
import {
  AssetStorageService,
  isR2StorageRef,
} from '../../infrastructure/storage/asset-storage.service';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { ReportJobsRepository } from './report-jobs.repository';

export const REPORT_GENERATION_JOB = 'generate';

@Injectable()
export class ReportingService {
  constructor(
    private readonly storage: AssetStorageService,
    private readonly campaigns: CampaignsRepository,
    private readonly reportJobs: ReportJobsRepository,
    @InjectQueue('report-generation') private readonly reportQueue: Queue
  ) {}

  async requestProofOfPlay(
    body: ProofOfPlayRequest,
    requestedByUserId: string | null
  ): Promise<ReportJobAccepted> {
    const campaign = await this.campaigns.findByCampaignId(body.campaignId);
    if (!campaign) {
      throw new NotFoundException({ code: 'CAMPAIGN_NOT_FOUND', message: body.campaignId });
    }

    const jobId = randomUUID();
    const estimated = new Date(Date.now() + 5 * 60_000).toISOString();

    await this.reportJobs.create({
      jobId,
      campaignId: body.campaignId,
      format: body.format,
      status: 'queued',
      filePath: null,
      downloadPath: null,
      impressionCount: null,
      totalBillableValueCents: null,
      errorMessage: null,
      requestedByUserId,
    });

    await this.reportQueue.add(
      REPORT_GENERATION_JOB,
      { jobId },
      { removeOnComplete: true }
    );

    return {
      reportJobId: jobId,
      status: 'queued',
      estimatedReadyAt: estimated,
    };
  }

  async getJobStatus(jobId: string): Promise<ReportJobStatus> {
    const job = await this.reportJobs.findByJobId(jobId);
    if (!job) {
      throw new NotFoundException({ code: 'REPORT_JOB_NOT_FOUND', message: jobId });
    }

    let downloadUrl: string | null = null;
    if (
      job.status === 'ready' &&
      job.filePath &&
      isR2StorageRef(job.filePath)
    ) {
      downloadUrl = await this.storage.getPresignedGetUrl(job.filePath, 3600);
    }

    const campaign = await this.campaigns.findByCampaignId(job.campaignId);
    const currency = campaign?.budget.currency ?? 'USD';

    return {
      reportJobId: job.jobId,
      status: job.status,
      downloadUrl,
      summary: {
        totalImpressions: job.impressionCount ?? 0,
        uniqueZonesReached: 0,
        estimatedUniquePassengersReached: 0,
        totalBillableValueCents: job.totalBillableValueCents ?? 0,
        currency,
      },
    };
  }
}
