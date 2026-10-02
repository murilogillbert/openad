import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { DevicesRepository } from '../devices/devices.repository';
import { VehiclesRepository } from './vehicles.repository';
import { VehicleBindingAuditService } from './vehicle-binding-audit.service';

@Injectable()
export class VehicleBindingService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly vehicles: VehiclesRepository,
    private readonly devices: DevicesRepository,
    private readonly bindingAudit: VehicleBindingAuditService
  ) {
    this.logger.setContext(VehicleBindingService.name);
  }

  async pair(
    vehicleId: string,
    deviceId: string,
    audit: FleetAuditContext
  ): Promise<{ vehicleId: string; deviceId: string }> {
    const vehicle = await this.vehicles.findByVehicleId(vehicleId);
    if (!vehicle) {
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', vehicleId });
    }
    if (vehicle.status === 'decommissioned') {
      throw new ConflictException({
        code: 'VEHICLE_DECOMMISSIONED',
        message: 'Cannot pair to a decommissioned vehicle',
      });
    }

    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', deviceId });
    }

    if (device.boundVehicleId && device.boundVehicleId !== vehicleId) {
      throw new ConflictException({
        code: 'DEVICE_BOUND_ELSEWHERE',
        message: 'Device is already bound to another vehicle',
      });
    }

    const paired = vehicle.pairedDeviceIds ?? [];
    if (paired.includes(deviceId)) {
      return { vehicleId, deviceId };
    }

    await this.vehicles.updateOne(
      { vehicleId },
      { $addToSet: { pairedDeviceIds: deviceId } }
    );
    await this.devices.updateOne(
      { deviceId },
      {
        $set: {
          boundVehicleId: vehicleId,
          boundAt: new Date(),
          lifecycleState: 'Active',
        },
      }
    );

    await this.bindingAudit.append(
      { action: 'pair', vehicleId, deviceId },
      audit
    );

    this.logger.info(
      {
        ...audit,
        event: 'vehicle.pair.success',
        vehicleId,
        deviceId,
      },
      'vehicle paired with device'
    );

    return { vehicleId, deviceId };
  }

  async unpair(
    vehicleId: string,
    deviceId: string,
    audit: FleetAuditContext
  ): Promise<{ vehicleId: string; deviceId: string }> {
    const vehicle = await this.vehicles.findByVehicleId(vehicleId);
    if (!vehicle) {
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', vehicleId });
    }

    const paired = vehicle.pairedDeviceIds ?? [];
    if (!paired.includes(deviceId)) {
      throw new ConflictException({
        code: 'DEVICE_NOT_PAIRED',
        message: 'Device is not paired to this vehicle',
      });
    }

    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', deviceId });
    }

    await this.vehicles.updateOne(
      { vehicleId },
      { $pull: { pairedDeviceIds: deviceId } }
    );
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

    await this.bindingAudit.append(
      { action: 'unpair', vehicleId, deviceId },
      audit
    );

    this.logger.info(
      {
        ...audit,
        event: 'vehicle.unpair.success',
        vehicleId,
        deviceId,
      },
      'vehicle unpaired from device'
    );

    return { vehicleId, deviceId };
  }
}
