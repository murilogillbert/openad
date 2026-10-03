import type { Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import type { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import type { CampaignsRepository } from '../campaigns/campaigns.repository';
import type { ImpressionEventsRepository } from '../impressions/impression-events.repository';
import { ReportGenerationWorker } from './report-generation.worker';
import type { NotificationService } from '../fleet-monitor/notification.service';
import type { ReportJobsRepository } from './report-jobs.repository';

describe('ReportGenerationWorker', () => {
  it('writes JSON report and sets job to ready with impression totals', async () => {
    const storage = {
      putObjectAtKey: jest
        .fn()
        .mockResolvedValue('r2:reports/job-test-1.json'),
    } as unknown as AssetStorageService;

    const reportJobs: Pick<
      ReportJobsRepository,
      'findByJobId' | 'updateOne'
    > = {
      findByJobId: jest.fn().mockResolvedValue({
        jobId: 'job-test-1',
        campaignId: 'camp-1',
        format: 'json',
        status: 'queued',
        filePath: null,
        downloadPath: null,
        impressionCount: null,
        totalBillableValueCents: null,
        errorMessage: null,
      }),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };

    const campaigns: Pick<CampaignsRepository, 'findByCampaignId'> = {
      findByCampaignId: jest.fn().mockResolvedValue({
        name: 'Test campaign',
        advertiserName: 'Adv',
        budget: {
          currency: 'USD',
          totalAmountCents: 100_000,
          ratePerImpressionCents: 5,
        },
      }),
    };

    const impressions: Pick<
      ImpressionEventsRepository,
      'findByCampaignId'
    > = {
      findByCampaignId: jest.fn().mockResolvedValue([
        {
          eventId: 'ev-1',
          vehicleId: 'veh-1',
          playedAt: new Date('2026-01-01T12:00:00Z'),
          billingValueCents: 5,
          currency: 'USD',
          locationVerified: true,
        },
      ]),
    };

    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as PinoLogger;

    const notifications = {
      broadcastDashboard: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationService;

    const worker = new ReportGenerationWorker(
      logger,
      storage,
      reportJobs as ReportJobsRepository,
      impressions as ImpressionEventsRepository,
      campaigns as CampaignsRepository,
      notifications
    );

    await worker.process({
      data: { jobId: 'job-test-1' },
    } as Job<{ jobId: string }>);

    const updates = (reportJobs.updateOne as jest.Mock).mock.calls.map(
      (c) =>
        c[1] as {
          $set?: {
            status?: string;
            impressionCount?: number;
            filePath?: string;
            totalBillableValueCents?: number;
          };
        }
    );
    const ready = updates.find((u) => u.$set?.status === 'ready');
    expect(ready?.$set?.status).toBe('ready');
    expect(ready?.$set?.impressionCount).toBe(1);
    expect(ready?.$set?.totalBillableValueCents).toBe(5);
    expect(ready?.$set?.filePath).toBe('r2:reports/job-test-1.json');
    expect(storage.putObjectAtKey).toHaveBeenCalledWith(
      'reports/job-test-1.json',
      expect.any(Buffer),
      'application/json'
    );
  });
});
