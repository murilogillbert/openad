import { PinoLogger } from 'nestjs-pino';
import { DeviceStateMachineService } from '../devices/device-state-machine.service';
import { DevicesRepository } from '../devices/devices.repository';
import { FleetStatusRepository } from '../vehicles/fleet-status.repository';
import { FleetGateway } from './fleet-gateway';
import { HeartbeatMonitorService } from './heartbeat-monitor.service';
import { NotificationService } from './notification.service';
import type { PlatformConfig } from '@openad/api-contracts';
import type { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';

describe('HeartbeatMonitorService', () => {
  const logger: Pick<PinoLogger, 'setContext' | 'warn'> = {
    setContext: jest.fn(),
    warn: jest.fn(),
  };

  let flaggedAfter = 180_000;
  const cfg: Pick<PlatformConfigRuntimeService, 'get'> = {
    get: () =>
      ({
        dashboard: { mediaStorageQuotaBytes: null },
        mediaLimits: {
          maxVideoBytes: 1,
          maxDurationSeconds: 1,
          maxWidth: 1,
          maxHeight: 1,
        },
        fleetHealth: {
          minBatteryPercent: 10,
          maxStoragePercent: 95,
          gpsHdopMax: 5,
          heartbeatFlaggedThresholdMs: flaggedAfter,
        },
        analytics: {
          enabled: true,
          maxVelocityKmh: 200,
          playBatchMaxBytes: 5_242_880,
          reconFullPlayMinRatio: 0.9,
          reconMinDurationSec: 3,
          fraudBlackoutMaxLux: 5,
          fraudHeartbeatIntervalSec: 30,
          fraudHeartbeatMinRatio: 0.25,
        },
      }) satisfies PlatformConfig,
  };

  const fleetStatus = {
    findAll: jest.fn(),
    markOffline: jest.fn(),
  } as unknown as jest.Mocked<FleetStatusRepository>;

  const notifications = {
    alertAdmins: jest.fn(),
    broadcastDashboard: jest.fn(),
  } as unknown as jest.Mocked<NotificationService>;

  const devices = {
    findByDeviceId: jest.fn(),
  } as unknown as jest.Mocked<DevicesRepository>;

  const fsm = {
    transitionTo: jest.fn(),
  } as unknown as jest.Mocked<DeviceStateMachineService>;

  const gateway = {
    emitDeviceStateChanged: jest.fn(),
    requestFleetMapRefresh: jest.fn(),
  } as unknown as jest.Mocked<FleetGateway>;

  beforeEach(() => {
    jest.clearAllMocks();
    flaggedAfter = 180_000;
    fsm.transitionTo.mockResolvedValue({
      eventId: 'e1',
      deviceId: 'd1',
      fromState: 'Active',
      toState: 'Flagged',
      trigger: { type: 'system', detail: 'heartbeat_timeout' },
      occurredAt: new Date().toISOString(),
    });
  });

  it('does not transition fresh telemetry', async () => {
    const now = new Date();
    fleetStatus.findAll.mockResolvedValue([
      {
        deviceId: 'd1',
        vehicleId: 'v1',
        reportedAt: now,
        connectivity: { status: 'online' },
        alertFlags: [],
      },
    ] as never);
    devices.findByDeviceId.mockResolvedValue({
      lifecycleState: 'Active',
    } as never);

    const svc = new HeartbeatMonitorService(
      logger as PinoLogger,
      cfg as any,
      fleetStatus,
      notifications,
      devices,
      fsm,
      gateway
    );
    await svc.sweepStaleHeartbeats();

    expect(fsm.transitionTo).not.toHaveBeenCalled();
  });

  it('after FLAGGED_AFTER_MS without heartbeat calls FSM Flagged with heartbeat_timeout', async () => {
    flaggedAfter = 180_000;
    const stale = new Date(Date.now() - flaggedAfter - 10_000);
    fleetStatus.findAll.mockResolvedValue([
      {
        deviceId: 'd1',
        vehicleId: 'v1',
        reportedAt: stale,
        connectivity: { status: 'online' },
        alertFlags: [],
      },
    ] as never);
    devices.findByDeviceId.mockResolvedValue({
      deviceId: 'd1',
      lifecycleState: 'Active',
    } as never);

    const svc = new HeartbeatMonitorService(
      logger as PinoLogger,
      cfg as any,
      fleetStatus,
      notifications,
      devices,
      fsm,
      gateway
    );
    await svc.sweepStaleHeartbeats();

    expect(fsm.transitionTo).toHaveBeenCalledWith('d1', 'Flagged', {
      type: 'system',
      detail: 'heartbeat_timeout',
    });
    expect(gateway.emitDeviceStateChanged).toHaveBeenCalled();
    expect(notifications.alertAdmins).toHaveBeenCalled();
  });

  it('skips already-offline devices', async () => {
    const stale = new Date(Date.now() - 200_000);
    fleetStatus.findAll.mockResolvedValue([
      {
        deviceId: 'd1',
        vehicleId: 'v1',
        reportedAt: stale,
        connectivity: { status: 'offline' },
        alertFlags: [],
      },
    ] as never);

    const svc = new HeartbeatMonitorService(
      logger as PinoLogger,
      cfg as any,
      fleetStatus,
      notifications,
      devices,
      fsm,
      gateway
    );
    await svc.sweepStaleHeartbeats();

    expect(fsm.transitionTo).not.toHaveBeenCalled();
  });
});
