import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { AssetIntegrityService } from './asset-integrity.service';

const systemAudit = (): FleetAuditContext => ({
  correlationId: 'asset-integrity-worker',
  operatorUserId: 'system',
  operatorEmail: 'system@openad.local',
  operatorRole: 'system',
});

@Processor('asset-propagation')
export class AssetIntegrityWorker extends WorkerHost {
  constructor(
    private readonly logger: PinoLogger,
    private readonly integrity: AssetIntegrityService
  ) {
    super();
    this.logger.setContext(AssetIntegrityWorker.name);
  }

  async process(job: Job<{ assetId: string }>): Promise<void> {
    const audit = systemAudit();
    this.logger.info(
      { ...audit, jobId: job.id, assetId: job.data.assetId },
      'asset integrity job started'
    );
    await this.integrity.verifyAssetFile(job.data.assetId, audit);
  }
}
