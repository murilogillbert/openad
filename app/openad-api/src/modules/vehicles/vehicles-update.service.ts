import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import type { VehicleDetailResponse } from '@openad/api-contracts';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehiclesRepository } from './vehicles.repository';
import { VehiclesQueryService } from './vehicles-query.service';

@Injectable()
export class VehiclesUpdateService {
  constructor(
    private readonly vehicles: VehiclesRepository,
    private readonly query: VehiclesQueryService
  ) {}

  async update(
    vehicleId: string,
    dto: UpdateVehicleDto,
    audit: FleetAuditContext
  ): Promise<VehicleDetailResponse> {
    const existing = await this.vehicles.findByVehicleId(vehicleId);
    if (!existing) {
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', vehicleId });
    }

    const $set: Record<string, unknown> = {};

    if (dto.registrationPlate !== undefined) {
      $set.registrationPlate = dto.registrationPlate.trim();
    }
    if (dto.make !== undefined) {
      $set.make = dto.make.trim();
    }
    if (dto.model !== undefined) {
      $set.model = dto.model.trim();
    }
    if (dto.year !== undefined) {
      $set.year = dto.year;
    }
    if (dto.commercialTier !== undefined) {
      $set.commercialTier = dto.commercialTier;
    }
    if (dto.driverId !== undefined) {
      const t = dto.driverId.trim();
      $set.driverId = t.length === 0 ? null : t;
    }
    if (dto.inShop !== undefined) {
      $set.inShop = dto.inShop;
    }
    if (dto.characteristics !== undefined) {
      $set.characteristics = {
        ...existing.characteristics,
        ...dto.characteristics,
      };
    }

    if (Object.keys($set).length === 0) {
      const cur = await this.query.findOne(vehicleId, audit);
      if (!cur) {
        throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', vehicleId });
      }
      return cur;
    }

    try {
      const updated = await this.vehicles.updateOne({ vehicleId }, { $set });
      if (!updated) {
        throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', vehicleId });
      }
    } catch (err: unknown) {
      if (isMongoDuplicateKey(err)) {
        throw new ConflictException({
          code: 'DUPLICATE_REGISTRATION_PLATE',
          message: 'Registration plate must be unique',
        });
      }
      throw err;
    }

    const detail = await this.query.findOne(vehicleId, audit);
    if (!detail) {
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', vehicleId });
    }
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
