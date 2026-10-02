import { Global, Logger, Module } from '@nestjs/common';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

/** Placeholder worker: move SHA-256 hashing off the HTTP thread (T127). */
@Processor('hash-calculation')
export class HashCalculationProcessor extends WorkerHost {
  private readonly log = new Logger(HashCalculationProcessor.name);

  async process(job: Job): Promise<void> {
    this.log.debug(`hash-calculation job ${String(job.id)} acknowledged`);
  }
}

/** Placeholder worker: temp/orphan object cleanup (T128). */
@Processor('file-cleanup')
export class FileCleanupProcessor extends WorkerHost {
  private readonly log = new Logger(FileCleanupProcessor.name);

  async process(job: Job): Promise<void> {
    this.log.debug(`file-cleanup job ${String(job.id)} acknowledged`);
  }
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const url = (process.env.REDIS_URL ?? '').trim();
        if (!url) {
          throw new Error(
            'REDIS_URL is required for queues. Start the API via `pnpm api:serve` (dotenvx) or export REDIS_URL before running.'
          );
        }
        return { connection: { url } };
      },
    }),
    BullModule.registerQueue(
      { name: 'report-generation' },
      { name: 'asset-propagation' },
      { name: 'command-dispatch' },
      { name: 'asset-url-rotation' },
      { name: 'hash-calculation' },
      { name: 'file-cleanup' },
      { name: 'analytics-reconciliation' }
    ),
  ],
  providers: [HashCalculationProcessor, FileCleanupProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
