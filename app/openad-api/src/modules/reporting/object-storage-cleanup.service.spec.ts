import { PinoLogger } from 'nestjs-pino';
import type { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import type { RemoteCommandsRepository } from '../fleet-monitor/remote-commands.repository';
import { ObjectStorageCleanupService } from './object-storage-cleanup.service';
import type { ReportJobsRepository } from './report-jobs.repository';

describe('ObjectStorageCleanupService', () => {
  const makeService = (opts: {
    reportDays?: number;
    shotDays?: number;
    staleReports?: Array<{ jobId: string; filePath: string }>;
    staleShots?: Array<{ commandId: string; screenshotStorageUrl: string }>;
  }) => {
    const envBefore = { ...process.env };
    process.env.REPORT_EXPORT_RETENTION_DAYS = String(opts.reportDays ?? 30);
    process.env.SCREENSHOT_RETENTION_DAYS = String(opts.shotDays ?? 14);

    const deleted: string[] = [];
    const storage = {
      deleteObjectByRef: jest.fn(async (ref: string) => {
        deleted.push(ref);
      }),
    } as unknown as AssetStorageService;

    const reportJobs = {
      findStaleReportExports: jest.fn(async () => opts.staleReports ?? []),
      clearReportExportPaths: jest.fn(async () => undefined),
    } as unknown as ReportJobsRepository;

    const remoteCommands = {
      findStaleScreenshotRefs: jest.fn(async () => opts.staleShots ?? []),
      clearScreenshotStorage: jest.fn(async () => undefined),
    } as unknown as RemoteCommandsRepository;

    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    } as unknown as PinoLogger;

    const svc = new ObjectStorageCleanupService(
      logger,
      storage,
      reportJobs,
      remoteCommands
    );
    return {
      svc,
      deleted,
      storage,
      reportJobs,
      remoteCommands,
      restoreEnv: () => {
        process.env = { ...envBefore };
      },
    };
  };

  it('deletes stale report exports and clears paths', async () => {
    const stale = [
      {
        jobId: 'j1',
        filePath: 'r2:reports/j1.csv',
      },
    ];
    const { svc, deleted, reportJobs, storage, restoreEnv } = makeService({
      staleReports: stale,
    });

    const r = await svc.purgeReportExports();
    restoreEnv();

    expect(r.purged).toBe(1);
    expect(r.errors).toBe(0);
    expect(deleted).toEqual(['r2:reports/j1.csv']);
    expect(storage.deleteObjectByRef).toHaveBeenCalledWith('r2:reports/j1.csv');
    expect(reportJobs.clearReportExportPaths).toHaveBeenCalledWith('j1');
  });

  it('deletes stale screenshots and clears storage fields', async () => {
    const stale = [
      {
        commandId: 'c1',
        screenshotStorageUrl: 'r2:screenshots/d1/c1.png',
      },
    ];
    const { svc, deleted, remoteCommands, storage, restoreEnv } = makeService({
      staleShots: stale,
    });

    const r = await svc.purgeScreenshots();
    restoreEnv();

    expect(r.purged).toBe(1);
    expect(r.errors).toBe(0);
    expect(deleted).toEqual(['r2:screenshots/d1/c1.png']);
    expect(storage.deleteObjectByRef).toHaveBeenCalledWith(
      'r2:screenshots/d1/c1.png'
    );
    expect(remoteCommands.clearScreenshotStorage).toHaveBeenCalledWith('c1');
  });

  it('counts errors when delete fails but does not clear DB', async () => {
    const stale = [
      { jobId: 'j-bad', filePath: 'r2:reports/j-bad.csv' },
    ];
    const storage = {
      deleteObjectByRef: jest.fn(async () => {
        throw new Error('network');
      }),
    } as unknown as AssetStorageService;

    const reportJobs = {
      findStaleReportExports: jest.fn(async () => stale),
      clearReportExportPaths: jest.fn(),
    } as unknown as ReportJobsRepository;

    const remoteCommands = {
      findStaleScreenshotRefs: jest.fn(async () => []),
      clearScreenshotStorage: jest.fn(),
    } as unknown as RemoteCommandsRepository;

    const envBefore = { ...process.env };
    process.env.REPORT_EXPORT_RETENTION_DAYS = '30';

    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    } as unknown as PinoLogger;

    const svc = new ObjectStorageCleanupService(
      logger,
      storage,
      reportJobs,
      remoteCommands
    );

    const r = await svc.purgeReportExports();
    process.env = { ...envBefore };

    expect(r.purged).toBe(0);
    expect(r.errors).toBe(1);
    expect(reportJobs.clearReportExportPaths).not.toHaveBeenCalled();
  });
});
