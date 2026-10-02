import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { RemoteCommandsRepository } from '../fleet-monitor/remote-commands.repository';
import { ReportJobsRepository } from './report-jobs.repository';

const BATCH = 200;
const MAX_ROUNDS = 50;

/**
 * Deletes expired report exports and device screenshots from object storage and clears DB refs
 * so the bucket does not grow unbounded.
 */
@Injectable()
export class ObjectStorageCleanupService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly storage: AssetStorageService,
    private readonly reportJobs: ReportJobsRepository,
    private readonly remoteCommands: RemoteCommandsRepository
  ) {
    this.logger.setContext(ObjectStorageCleanupService.name);
  }

  @Cron('0 3 * * *')
  async scheduledPurge(): Promise<void> {
    const reports = await this.purgeReportExports();
    const shots = await this.purgeScreenshots();
    if (reports.purged > 0 || shots.purged > 0) {
      this.logger.info(
        {
          event: 'storage.ephemeral_purge',
          reportExportsPurged: reports.purged,
          screenshotsPurged: shots.purged,
          reportErrors: reports.errors,
          screenshotErrors: shots.errors,
        },
        'object storage cleanup completed'
      );
    }
  }

  async purgeReportExports(): Promise<{ purged: number; errors: number }> {
    const days = Number(process.env.REPORT_EXPORT_RETENTION_DAYS ?? 30);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let purged = 0;
    let errors = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const batch = await this.reportJobs.findStaleReportExports(
        cutoff,
        BATCH
      );
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        try {
          await this.storage.deleteObjectByRef(row.filePath);
          await this.reportJobs.clearReportExportPaths(row.jobId);
          purged++;
        } catch (e: unknown) {
          errors++;
          this.logger.warn(
            {
              jobId: row.jobId,
              err: e instanceof Error ? e.message : String(e),
              event: 'storage.report_export_purge_failed',
            },
            'failed to purge report export object'
          );
        }
      }
      if (batch.length < BATCH) {
        break;
      }
    }
    return { purged, errors };
  }

  async purgeScreenshots(): Promise<{ purged: number; errors: number }> {
    const days = Number(process.env.SCREENSHOT_RETENTION_DAYS ?? 14);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let purged = 0;
    let errors = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const batch = await this.remoteCommands.findStaleScreenshotRefs(
        cutoff,
        BATCH
      );
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        try {
          await this.storage.deleteObjectByRef(row.screenshotStorageUrl);
          await this.remoteCommands.clearScreenshotStorage(row.commandId);
          purged++;
        } catch (e: unknown) {
          errors++;
          this.logger.warn(
            {
              commandId: row.commandId,
              err: e instanceof Error ? e.message : String(e),
              event: 'storage.screenshot_purge_failed',
            },
            'failed to purge screenshot object'
          );
        }
      }
      if (batch.length < BATCH) {
        break;
      }
    }
    return { purged, errors };
  }
}
