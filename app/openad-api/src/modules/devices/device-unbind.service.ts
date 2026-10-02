import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { RabbitmqTabletCredentialsService } from '../../infrastructure/rabbitmq/rabbitmq-tablet-credentials.service';
import { FleetDomainEventsService } from '../vehicles/fleet-domain-events.service';
import { DevicesRepository } from './devices.repository';
import { VehiclesRepository } from '../vehicles/vehicles.repository';

@Injectable()
export class DeviceUnbindService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly devices: DevicesRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly events: FleetDomainEventsService,
    private readonly tabletMqtt: RabbitmqTabletCredentialsService
  ) {
    this.logger.setContext(DeviceUnbindService.name);
  }

  async unbind(
    deviceId: string,
    audit: FleetAuditContext
  ): Promise<{ deviceId: string; lifecycleState: 'Flagged' }> {
    this.logger.info(
      { ...audit, event: 'device.unbind.attempt', deviceId },
      'device unbind attempt'
    );

    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      this.logger.warn(
        { ...audit, event: 'device.unbind.failed', reason: 'not_found', deviceId },
        'device unbind rejected: not found'
      );
      throw new NotFoundException('Device not found');
    }

    const vehicleId = device.boundVehicleId;
    await this.devices.updateOne(
      { deviceId },
      {
        $set: {
          lifecycleState: 'Flagged',
          boundVehicleId: null,
          boundAt: null,
        },
      }
    );

    if (vehicleId) {
      await this.vehicles.updateOne(
        { vehicleId },
        { $pull: { pairedDeviceIds: deviceId } }
      );
    }

    this.events.deviceUnbound$.next({ deviceId });

    await this.tabletMqtt.deleteForDevice(deviceId);

    this.logger.info(
      {
        ...audit,
        event: 'device.unbind.success',
        deviceId,
        previousVehicleId: vehicleId ?? null,
      },
      'device unbound'
    );

    return { deviceId, lifecycleState: 'Flagged' };
  }
}
