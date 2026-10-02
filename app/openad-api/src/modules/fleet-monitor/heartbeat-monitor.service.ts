import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { DeviceStateMachineService } from '../devices/device-state-machine.service';
import { DevicesRepository } from '../devices/devices.repository';
import { FleetStatusRepository } from '../vehicles/fleet-status.repository';
import { NotificationService } from './notification.service';
import { FleetGateway } from './fleet-gateway';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';

@Injectable()
export class HeartbeatMonitorService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly cfg: PlatformConfigRuntimeService,
    private readonly fleetStatus: FleetStatusRepository,
    private readonly notifications: NotificationService,
    private readonly devices: DevicesRepository,
    private readonly fsm: DeviceStateMachineService,
    private readonly gateway: FleetGateway
  ) {
    this.logger.setContext(HeartbeatMonitorService.name);
  }

  @Cron('*/30 * * * * *')
  async sweepStaleHeartbeats(): Promise<void> {
    const flaggedAfterMs = this.cfg.get().fleetHealth.heartbeatFlaggedThresholdMs;
    const cutoff = new Date(Date.now() - flaggedAfterMs);
    const docs = await this.fleetStatus.findAll();
    let transitioned = 0;

    for (const doc of docs) {
      if (doc.reportedAt >= cutoff) continue;
      if (doc.connectivity.status === 'offline') continue;

      const device = await this.devices.findByDeviceId(doc.deviceId);
      if (!device) continue;

      if (device.lifecycleState !== 'Active') continue;

      try {
        const ev = await this.fsm.transitionTo(doc.deviceId, 'Flagged', {
          type: 'system',
          detail: 'heartbeat_timeout',
        });
        transitioned++;

        this.gateway.emitDeviceStateChanged({
          type: 'device_state_changed',
          deviceId: doc.deviceId,
          vehicleId: doc.vehicleId,
          fromState: ev.fromState,
          toState: ev.toState,
          trigger: { type: 'system', detail: 'heartbeat_timeout' },
          occurredAt: ev.occurredAt,
        });
      } catch (e: unknown) {
        this.logger.warn(
          { deviceId: doc.deviceId, err: e },
          'heartbeat sweep: transition skipped'
        );
        continue;
      }

      await this.notifications.alertAdmins(
        doc.deviceId,
        'Device connectivity lost',
        `No telemetry from device ${doc.deviceId} for over ${flaggedAfterMs / 1000}s (flagged).`,
        { vehicleId: doc.vehicleId }
      );
      await this.notifications.broadcastDashboard({
        type: 'device_offline',
        deviceId: doc.deviceId,
        vehicleId: doc.vehicleId,
      });
    }

    if (transitioned > 0) {
      this.logger.warn(
        { event: 'heartbeat.sweep', transitioned },
        'flagged devices after stale telemetry'
      );
      this.gateway.requestFleetMapRefresh();
    }
  }
}
