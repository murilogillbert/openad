import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

@Injectable()
export class AssetUrlRotationScheduler implements OnModuleInit {
  private readonly logger = new Logger(AssetUrlRotationScheduler.name);

  constructor(
    @InjectQueue('asset-url-rotation') private readonly queue: Queue
  ) {}

  async onModuleInit(): Promise<void> {
    if (
      (process.env.SKIP_ASSET_ROTATION ?? '') === 'true' ||
      process.env.NODE_ENV === 'test'
    ) {
      this.logger.log('Skipping asset URL rotation scheduler (test or disabled)');
      return;
    }
    try {
      await this.queue.add(
        'rotate',
        {},
        {
          repeat: { pattern: '*/30 * * * *' },
          jobId: 'asset-url-rotation-repeat',
          removeOnComplete: true,
        }
      );
      this.logger.log('Registered repeatable asset-url-rotation job (every 30 min)');
    } catch (e) {
      this.logger.warn(
        `Could not register asset URL rotation job: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}
