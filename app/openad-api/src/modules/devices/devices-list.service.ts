import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  DeviceInventoryItem,
  Paginated,
} from '@openad/api-contracts';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { DevicesRepository } from './devices.repository';
import { DeviceListQueryDto } from './dto/device-list-query.dto';

@Injectable()
export class DevicesListService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly devices: DevicesRepository,
    private readonly vehicles: VehiclesRepository
  ) {
    this.logger.setContext(DevicesListService.name);
  }

  async findAll(
    query: DeviceListQueryDto,
    audit: FleetAuditContext
  ): Promise<Paginated<DeviceInventoryItem>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 500);
    const filter = this.buildFilter(query);

    this.logger.info(
      {
        ...audit,
        event: 'devices.inventory.query',
        page,
        limit,
        lifecycleState: query.lifecycleState ?? null,
        search: query.search ?? null,
      },
      'device inventory query'
    );

    const [rows, total] = await Promise.all([
      this.devices.findMany(filter, {
        skip: (page - 1) * limit,
        limit,
        sort: { serialNumber: 1 },
      }),
      this.devices.countDocuments(filter),
    ]);

    const vehicleIds = [
      ...new Set(
        rows
          .map((d) => d.boundVehicleId)
          .filter((id): id is string => id != null && id.length > 0)
      ),
    ];

    const plateByVehicleId = new Map<string, string>();
    if (vehicleIds.length > 0) {
      const vehDocs = await this.vehicles.findMany(
        { vehicleId: { $in: vehicleIds } },
        { limit: vehicleIds.length }
      );
      for (const v of vehDocs) {
        plateByVehicleId.set(v.vehicleId, v.registrationPlate);
      }
    }

    const data: DeviceInventoryItem[] = rows.map((d) => ({
      deviceId: d.deviceId,
      serialNumber: d.serialNumber,
      lifecycleState: d.lifecycleState,
      lastSeenAt: d.lastSeenAt.toISOString(),
      boundVehicleId: d.boundVehicleId,
      boundVehicleRegistrationPlate: d.boundVehicleId
        ? plateByVehicleId.get(d.boundVehicleId) ?? null
        : null,
    }));

    return {
      data,
      pagination: { total, page, limit },
    };
  }

  private buildFilter(query: DeviceListQueryDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (query.lifecycleState) {
      filter.lifecycleState = query.lifecycleState;
    }
    const q = query.search?.trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ serialNumber: rx }, { deviceId: rx }];
    }
    return filter;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
