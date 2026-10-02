import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { DevicesRepository } from '../devices/devices.repository';
import { SchedulePushService } from './schedule-push.service';

const ROTATION_AUDIT: FleetAuditContext = {
  correlationId: 'asset-url-rotation',
  operatorUserId: 'system',
  operatorEmail: 'system@openad.local',
  operatorRole: 'system',
};

/**
 * Periodically re-publishes schedules so signed asset URLs stay fresh (24h TTL, refresh before 2h left).
 */
@Processor('asset-url-rotation')
export class AssetUrlRotationWorker extends WorkerHost {
  constructor(
    private readonly logger: PinoLogger,
    private readonly devices: DevicesRepository,
    private readonly schedulePush: SchedulePushService
  ) {
    super();
    this.logger.setContext(AssetUrlRotationWorker.name);
  }

  async process(_job: Job): Promise<void> {
    const ids = await this.devices.findActiveBoundDeviceIds();
    this.logger.info(
      { deviceCount: ids.length, event: 'asset_url.rotation.start' },
      'refreshing schedules for signed asset URLs'
    );
    for (const deviceId of ids) {
      try {
        await this.schedulePush.buildAndPublishForDevice(deviceId, ROTATION_AUDIT);
      } catch (e) {
        this.logger.warn(
          {
            deviceId,
            err: e instanceof Error ? e.message : String(e),
            event: 'asset_url.rotation.device_failed',
          },
          'schedule refresh failed for device'
        );
      }
    }
  }
}
