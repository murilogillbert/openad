import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { PinoLogger } from 'nestjs-pino';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { ImpressionEventsRepository } from '../impressions/impression-events.repository';
import { NotificationService } from '../fleet-monitor/notification.service';
import { ReportJobsRepository } from './report-jobs.repository';
import { aggregateByVehicle } from './report-aggregation.util';

@Processor('report-generation')
export class ReportGenerationWorker extends WorkerHost {
  constructor(
    private readonly logger: PinoLogger,
    private readonly storage: AssetStorageService,
    private readonly reportJobs: ReportJobsRepository,
    private readonly impressions: ImpressionEventsRepository,
    private readonly campaigns: CampaignsRepository,
    private readonly notifications: NotificationService
  ) {
    super();
    this.logger.setContext(ReportGenerationWorker.name);
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    const started = Date.now();
    const { jobId } = job.data;
    const rec = await this.reportJobs.findByJobId(jobId);
    if (!rec) {
      this.logger.warn({ jobId }, 'report job record missing');
      return;
    }

    await this.reportJobs.updateOne(
      { jobId },
      { $set: { status: 'processing' } }
    );

    try {
      const campaign = await this.campaigns.findByCampaignId(rec.campaignId);
      if (!campaign) {
        throw new Error(`campaign not found: ${rec.campaignId}`);
      }

      const rows = await this.impressions.findByCampaignId(rec.campaignId);
      const totalImpressions = rows.length;
      const totalBillable = rows.reduce((s, r) => s + r.billingValue, 0);
      const currency = campaign.budget.currency;

      const byVehicle = aggregateByVehicle(
        rows.map((r) => ({ vehicleId: r.vehicleId, billingValue: r.billingValue }))
      );

      const summary = {
        campaignId: rec.campaignId,
        campaignName: campaign.name,
        advertiserName: campaign.advertiserName,
        totalImpressions,
        totalBillableValue: totalBillable,
        currency,
        uniqueZonesReached: 0,
        byVehicle,
        generatedAt: new Date().toISOString(),
      };

      const ext =
        rec.format === 'csv' ? 'csv' : rec.format === 'pdf' ? 'pdf' : 'json';
      const objectKey = `reports/${jobId}.${ext}`;

      let body: Buffer;
      let contentType: string;

      if (rec.format === 'json') {
        contentType = 'application/json';
        body = Buffer.from(JSON.stringify(summary, null, 2), 'utf8');
      } else if (rec.format === 'csv') {
        contentType = 'text/csv; charset=utf-8';
        const header =
          'eventId,vehicleId,playedAt,billingValue,currency,locationVerified\n';
        const lines = rows
          .map(
            (r) =>
              `${r.eventId},${r.vehicleId},${r.playedAt.toISOString()},${r.billingValue},${r.currency},${r.locationVerified}`
          )
          .join('\n');
        body = Buffer.from(header + lines, 'utf8');
      } else {
        contentType = 'application/pdf';
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openad-rpt-'));
        const tmpPdf = path.join(tmpDir, `${jobId}.pdf`);
        try {
          await new Promise<void>((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50 });
            const stream = createWriteStream(tmpPdf);
            doc.pipe(stream);
            doc
              .fontSize(16)
              .text(`Proof-of-Play — ${campaign.name}`, { underline: true });
            doc.moveDown();
            doc.fontSize(11);
            doc.text(`Campaign ID: ${rec.campaignId}`);
            doc.text(`Advertiser: ${campaign.advertiserName}`);
            doc.text(`Total impressions: ${totalImpressions}`);
            doc.text(`Total billable value: ${totalBillable} ${currency}`);
            doc.moveDown();
            doc.text('Per-vehicle summary:', { underline: true });
            for (const [vid, v] of Object.entries(byVehicle)) {
              doc.text(
                `  ${vid}: ${v.impressions} plays, ${v.billableValue.toFixed(4)} ${currency}`
              );
            }
            doc.end();
            stream.on('finish', () => resolve());
            stream.on('error', reject);
          });
          body = await fs.readFile(tmpPdf);
        } finally {
          await fs.rm(tmpDir, { recursive: true }).catch(() => undefined);
        }
      }

      const storageUrl = await this.storage.putObjectAtKey(
        objectKey,
        body,
        contentType
      );

      await this.reportJobs.updateOne(
        { jobId },
        {
          $set: {
            status: 'ready',
            filePath: storageUrl,
            downloadPath: objectKey,
            impressionCount: totalImpressions,
            totalBillableValue: totalBillable,
          },
        }
      );

      await this.notifications.broadcastDashboard({
        type: 'report_ready',
        jobId,
        campaignId: rec.campaignId,
      });

      this.logger.info(
        {
          jobId,
          campaignId: rec.campaignId,
          impressionCount: totalImpressions,
          generationTimeMs: Date.now() - started,
          event: 'report.job.ready',
        },
        'report job completed'
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.reportJobs.updateOne(
        { jobId },
        { $set: { status: 'failed', errorMessage: msg } }
      );
      await this.notifications.broadcastDashboard({
        type: 'report_failed',
        jobId,
        campaignId: rec.campaignId,
        errorMessage: msg,
      });
      this.logger.error(
        { jobId, err: msg, event: 'report.job.failed' },
        'report job failed'
      );
    }
  }
}
