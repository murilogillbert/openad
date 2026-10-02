import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { HealthMetrics } from '@openad/domain';
import { telemetryPayloadSchema } from '@openad/mqtt-contracts';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { DeviceStateMachineService } from '../devices/device-state-machine.service';
import { DevicesRepository } from '../devices/devices.repository';
import { FleetStatusRepository } from '../vehicles/fleet-status.repository';
import type { FleetStatusRecord } from '../vehicles/fleet-status.schema';
import { HealthThresholdEvaluatorService } from './health-threshold-evaluator.service';
import { FleetGateway } from './fleet-gateway';

const TELEMETRY_STREAM = 'stream:telemetry';
const FLEET_CACHE_PREFIX = 'cache:fleet:';
const FLEET_CACHE_TTL_SEC = 35;

@Injectable()
export class TelemetryIngestorService implements OnModuleInit {
  constructor(
    private readonly logger: PinoLogger,
    private readonly mqtt: MqttService,
    private readonly redis: RedisService,
    private readonly devices: DevicesRepository,
    private readonly fleetStatus: FleetStatusRepository,
    private readonly healthThresholds: HealthThresholdEvaluatorService,
    private readonly fsm: DeviceStateMachineService,
    private readonly fleetGateway: FleetGateway
  ) {
    this.logger.setContext(TelemetryIngestorService.name);
  }

  onModuleInit(): void {
    this.mqtt.subscribe('openad/+/telemetry', (topic, payload) => {
      void this.handleTelemetry(topic, payload);
    });
    this.logger.info({}, 'Subscribed to openad/+/telemetry');
  }

  private extractDeviceId(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length >= 3 && parts[0] === 'openad' && parts[2] === 'telemetry') {
      return parts[1] ?? null;
    }
    return null;
  }

  async handleTelemetry(topic: string, payload: Buffer): Promise<void> {
    const deviceId = this.extractDeviceId(topic);
    if (!deviceId) return;

    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn({ deviceId, event: 'telemetry.parse_error' }, 'invalid JSON');
      return;
    }

    const parsed = telemetryPayloadSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(
        { deviceId, issues: parsed.error.issues },
        'telemetry schema validation failed'
      );
      return;
    }

    const tel = parsed.data;
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device?.boundVehicleId) {
      this.logger.debug({ deviceId }, 'telemetry ignored: device unbound');
      return;
    }

    const degraded =
      tel.alertFlags.includes('PLAYBACK_ERROR') ||
      tel.alertFlags.includes('LOW_STORAGE') ||
      tel.connectivity.networkType === 'none';

    const connectivityStatus = degraded ? 'degraded' : 'online';

    const doc: Partial<FleetStatusRecord> & Pick<FleetStatusRecord, 'vehicleId'> = {
      vehicleId: device.boundVehicleId,
      reportedAt: new Date(tel.ts),
      location: {
        type: 'Point',
        coordinates: [tel.location.lng, tel.location.lat],
      },
      connectivity: { status: connectivityStatus },
      playback: {
        status: tel.playback.status,
        currentCampaignId: tel.playback.currentCampaignId,
      },
      alertFlags: [...tel.alertFlags],
      lastAccuracyMeters: tel.location.accuracyMeters,
    };

    await this.redis.xadd(
      TELEMETRY_STREAM,
      '*',
      'deviceId',
      deviceId,
      'payload',
      JSON.stringify(tel)
    );

    await this.fleetStatus.upsertByDeviceId(deviceId, doc);

    const totalGb =
      device.capabilityManifest?.totalStorageGb ??
      Math.max(tel.device.storageFreeGb * 2, 1);
    const usedGb = Math.max(0, totalGb - tel.device.storageFreeGb);
    const storageUtilizationPercent = Math.min(
      100,
      Math.max(0, (usedGb / totalGb) * 100)
    );
    const gpsHdop = tel.location.gpsLocked
      ? Math.min(20, tel.location.accuracyMeters / 20)
      : 10;

    const healthMetrics: HealthMetrics = {
      batteryPercentage: tel.device.batteryPercent,
      storageUtilizationPercent,
      gpsHdop,
      gpsLocked: tel.location.gpsLocked,
      reportedAt: tel.ts,
    };

    await this.devices.updateOne(
      { deviceId },
      { $set: { lastHealthMetrics: healthMetrics } }
    );

    const breach = this.healthThresholds.evaluate(healthMetrics);
    const breachedField = this.healthThresholds.breachedField(healthMetrics);
    if (breach && device.lifecycleState === 'Active') {
      try {
        await this.fsm.transitionTo(deviceId, 'Flagged', {
          type: 'system',
          detail: `health_threshold:${breachedField ?? 'unknown'}`,
        });
      } catch (e: unknown) {
        this.logger.warn({ deviceId, err: e }, 'health FSM transition skipped');
      }
    } else if (!breach && device.lifecycleState === 'Flagged') {
      try {
        await this.fsm.transitionTo(deviceId, 'Active', {
          type: 'system',
          detail: 'health_metrics_recovered',
        });
      } catch (e: unknown) {
        this.logger.warn(
          { deviceId, err: e },
          'health recovery FSM transition skipped'
        );
      }
    }

    const cacheKey = `${FLEET_CACHE_PREFIX}${deviceId}`;
    await this.redis.set(
      cacheKey,
      JSON.stringify({
        deviceId,
        vehicleId: doc.vehicleId,
        reportedAt: doc.reportedAt!.toISOString(),
        location: { lng: tel.location.lng, lat: tel.location.lat },
        connectivity: doc.connectivity,
        playback: doc.playback,
        alertFlags: doc.alertFlags,
      }),
      FLEET_CACHE_TTL_SEC
    );

    this.logger.info(
      { deviceId, vehicleId: doc.vehicleId, event: 'telemetry.ingested' },
      'fleet telemetry ingested'
    );

    this.fleetGateway.requestFleetMapRefresh();
  }
}
