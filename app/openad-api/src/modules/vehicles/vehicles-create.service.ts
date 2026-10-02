import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import type { VehicleDetailResponse } from '@openad/api-contracts';
import { DevicesRepository } from '../devices/devices.repository';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import type { VehicleDocument } from './vehicles.schema';
import { VehicleBindingService } from './vehicle-binding.service';
import { VehiclesRepository } from './vehicles.repository';
import { VehiclesQueryService } from './vehicles-query.service';

@Injectable()
export class VehiclesCreateService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly vehicles: VehiclesRepository,
    private readonly devices: DevicesRepository,
    private readonly binding: VehicleBindingService,
    private readonly query: VehiclesQueryService
  ) {
    this.logger.setContext(VehiclesCreateService.name);
  }

  async create(
    dto: CreateVehicleDto,
    audit: FleetAuditContext,
    operatorId: string
  ): Promise<VehicleDetailResponse> {
    const vehicleId = randomUUID();
    const registrationPlate = dto.registrationPlate.trim();
    const driverRaw = dto.driverId?.trim();
    const driverId =
      driverRaw !== undefined && driverRaw.length > 0 ? driverRaw : null;

    const pairedDeviceIds = dedupeUuids(dto.pairedDeviceIds);

    this.logger.info(
      {
        ...audit,
        event: 'vehicles.create.attempt',
        vehicleId,
        registrationPlate,
      },
      'vehicle create'
    );

    try {
      const newVehicle = {
        vehicleId,
        registrationPlate,
        make: dto.make.trim(),
        model: dto.model.trim(),
        year: dto.year,
        status: 'active' as const,
        pairedDeviceIds: [] as string[],
        commercialTier: dto.commercialTier ?? 'other',
        driverId,
        inShop: false,
        operatorId,
        characteristics: { screenCount: 1, passengerCapacity: 4 },
        decommissionedAt: null,
      };
      // HydratedDocument inherits Mongoose's `model()` which collides with Vehicle.model in Partial<VehicleDocument>.
      await this.vehicles.create(
        newVehicle as unknown as Partial<VehicleDocument>
      );
    } catch (err: unknown) {
      if (isMongoDuplicateKey(err)) {
        throw new ConflictException({
          code: 'DUPLICATE_REGISTRATION_PLATE',
          message:
            'A vehicle with this registration plate already exists for an active or inactive unit',
        });
      }
      throw err;
    }

    for (const deviceId of pairedDeviceIds) {
      const device = await this.devices.findByDeviceId(deviceId);
      if (!device) {
        throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', deviceId });
      }
      const prev = device.boundVehicleId;
      if (prev && prev !== vehicleId) {
        await this.binding.unpair(prev, deviceId, audit);
      }
      await this.binding.pair(vehicleId, deviceId, audit);
    }

    const detail = await this.query.findOne(vehicleId, audit);
    if (!detail) {
      throw new InternalServerErrorException({
        code: 'VEHICLE_CREATE_INCONSISTENT',
        vehicleId,
      });
    }

    this.logger.info(
      {
        ...audit,
        event: 'vehicles.create.success',
        vehicleId,
      },
      'vehicle created'
    );

    return detail;
  }
}

function isMongoDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

function dedupeUuids(ids: string[] | undefined): string[] {
  if (!ids?.length) return [];
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
