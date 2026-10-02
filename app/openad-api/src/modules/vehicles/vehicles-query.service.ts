import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import type {
  Paginated,
  VehicleDetailResponse,
  VehicleListItem,
} from '@openad/api-contracts';
import {
  deriveVehicleBindingStatus,
  effectiveLastSeen,
} from './vehicle-binding-status.util';
import { DevicesRepository } from '../devices/devices.repository';
import { VehicleListQueryDto } from './dto/vehicle-list-query.dto';
import { VehiclesRepository } from './vehicles.repository';
import { FleetStatusRepository } from './fleet-status.repository';
import type { CapabilityManifest } from '@openad/domain';
import type { DeviceDocument } from '../devices/devices.schema';
import type { VehicleDocument } from './vehicles.schema';

@Injectable()
export class VehiclesQueryService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly vehicles: VehiclesRepository,
    private readonly devices: DevicesRepository,
    private readonly fleetStatus: FleetStatusRepository
  ) {
    this.logger.setContext(VehiclesQueryService.name);
  }

  async findAll(
    query: VehicleListQueryDto,
    audit: FleetAuditContext
  ): Promise<Paginated<VehicleListItem>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 500);
    const filter = this.buildFilter(query);

    this.logger.info(
      {
        ...audit,
        event: 'vehicles.list.query',
        page,
        limit,
        status: query.status ?? null,
        make: query.make ?? null,
        model: query.model ?? null,
      },
      'vehicles inventory query'
    );

    const [rows, total] = await Promise.all([
      this.vehicles.findMany(filter, {
        skip: (page - 1) * limit,
        limit,
        sort: { vehicleId: 1 },
      }),
      this.vehicles.countDocuments(filter),
    ]);

    const deviceIds = rows.flatMap((v) => v.pairedDeviceIds ?? []);

    const [deviceDocs, fleetDocs] = await Promise.all([
      this.devices.findByDeviceIds(deviceIds),
      this.fleetStatus.findByDeviceIds(deviceIds),
    ]);

    const deviceById = new Map(deviceDocs.map((d) => [d.deviceId, d]));
    const fleetByDevice = new Map(fleetDocs.map((f) => [f.deviceId, f]));

    const data: VehicleListItem[] = rows.map((v) =>
      this.mapVehicle(v, deviceById, fleetByDevice)
    );

    return {
      data,
      pagination: { total, page, limit },
    };
  }

  /**
   * Global fleet roster KPIs (matches management `app-inventory-list` rollup).
   * Uses full vehicle roster + device/fleet freshness (bounded scan).
   */
  async computeFleetRosterKpis(): Promise<{
    total: number;
    active: number;
    offline: number;
    other: number;
  }> {
    const total = await this.vehicles.countDocuments({});
    const rows = await this.vehicles.findMany({}, { sort: { vehicleId: 1 } });
    if (rows.length === 0) {
      return { total, active: 0, offline: 0, other: 0 };
    }
    const deviceIds = [...new Set(rows.flatMap((v) => v.pairedDeviceIds ?? []))];
    const [deviceDocs, fleetDocs] = await Promise.all([
      this.devices.findByDeviceIds(deviceIds),
      this.fleetStatus.findByDeviceIds(deviceIds),
    ]);
    const deviceById = new Map(deviceDocs.map((d) => [d.deviceId, d]));
    const fleetByDevice = new Map(fleetDocs.map((f) => [f.deviceId, f]));

    let active = 0;
    let offline = 0;
    for (const v of rows) {
      const item = this.mapVehicle(v, deviceById, fleetByDevice);
      if (item.status === 'active') {
        active++;
      }
      if (!item.boundDevice || isStaleLastSeenIso(item.boundDevice.lastSeenAt)) {
        offline++;
      }
    }
    const other = Math.max(0, rows.length - active - offline);
    return { total, active, offline, other };
  }

  async findOne(
    vehicleId: string,
    audit: FleetAuditContext
  ): Promise<VehicleDetailResponse | null> {
    this.logger.info(
      { ...audit, event: 'vehicles.detail.query', vehicleId },
      'vehicle detail query'
    );

    const v = await this.vehicles.findByVehicleId(vehicleId);
    if (!v) {
      return null;
    }

    const deviceIds = v.pairedDeviceIds ?? [];
    const [deviceDocs, fleetDocs] = await Promise.all([
      this.devices.findByDeviceIds(deviceIds),
      this.fleetStatus.findByDeviceIds(deviceIds),
    ]);

    const deviceById = new Map(deviceDocs.map((d) => [d.deviceId, d]));
    const fleetByDevice = new Map(fleetDocs.map((f) => [f.deviceId, f]));

    return this.mapVehicleDetail(v, deviceById, fleetByDevice);
  }

  private buildFilter(
    query: VehicleListQueryDto
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.make) {
      filter.make = new RegExp(escapeRegex(query.make), 'i');
    }
    if (query.model) {
      filter.model = new RegExp(escapeRegex(query.model), 'i');
    }
    return filter;
  }

  private mapVehicle(
    v: VehicleDocument,
    deviceById: Map<string, DeviceDocument>,
    fleetByDevice: Map<string, { deviceId: string; reportedAt: Date }>
  ): VehicleListItem {
    const paired = v.pairedDeviceIds ?? [];
    const lastSeenByDeviceId = this.buildLastSeenMap(
      paired,
      deviceById,
      fleetByDevice
    );
    const bindingStatus = deriveVehicleBindingStatus({
      inShop: v.inShop ?? false,
      pairedDeviceIds: paired,
      lastSeenByDeviceId,
    });

    let boundDevice: VehicleListItem['boundDevice'] = null;
    const primaryId = paired[0];
    if (primaryId) {
      const d = deviceById.get(primaryId);
      if (d) {
        const fs = fleetByDevice.get(d.deviceId);
        const lastSeen = effectiveLastSeen(d.lastSeenAt, fs?.reportedAt);
        boundDevice = {
          deviceId: d.deviceId,
          lifecycleState: d.lifecycleState,
          lastSeenAt: lastSeen.toISOString(),
        };
      }
    }

    return {
      vehicleId: v.vehicleId,
      registrationPlate: v.registrationPlate,
      make: v.make,
      model: v.model,
      status: v.status,
      pairedDeviceIds: [...paired],
      bindingStatus,
      inShop: v.inShop ?? false,
      boundDevice,
    };
  }

  private buildLastSeenMap(
    paired: string[],
    deviceById: Map<string, DeviceDocument>,
    fleetByDevice: Map<string, { deviceId: string; reportedAt: Date }>
  ): Map<string, Date> {
    const m = new Map<string, Date>();
    for (const id of paired) {
      const d = deviceById.get(id);
      if (!d) {
        m.set(id, new Date(0));
        continue;
      }
      const fs = fleetByDevice.get(d.deviceId);
      m.set(id, effectiveLastSeen(d.lastSeenAt, fs?.reportedAt));
    }
    return m;
  }

  private mapVehicleDetail(
    v: VehicleDocument,
    deviceById: Map<string, DeviceDocument>,
    fleetByDevice: Map<string, { deviceId: string; reportedAt: Date }>
  ): VehicleDetailResponse {
    const paired = v.pairedDeviceIds ?? [];
    const lastSeenByDeviceId = this.buildLastSeenMap(
      paired,
      deviceById,
      fleetByDevice
    );
    const bindingStatus = deriveVehicleBindingStatus({
      inShop: v.inShop ?? false,
      pairedDeviceIds: paired,
      lastSeenByDeviceId,
    });

    const boundDevice = this.mapBoundDeviceDetail(
      v,
      deviceById,
      fleetByDevice
    );

    return {
      vehicleId: v.vehicleId,
      registrationPlate: v.registrationPlate,
      make: v.make,
      model: v.model,
      year: v.year,
      status: v.status,
      operatorId: v.operatorId,
      commercialTier: v.commercialTier,
      pairedDeviceIds: [...paired],
      bindingStatus,
      driverId: v.driverId ?? null,
      inShop: v.inShop ?? false,
      characteristics: v.characteristics,
      decommissionedAt: v.decommissionedAt
        ? v.decommissionedAt.toISOString()
        : null,
      boundDevice,
    };
  }

  private mapBoundDeviceDetail(
    v: VehicleDocument,
    deviceById: Map<string, DeviceDocument>,
    fleetByDevice: Map<string, { deviceId: string; reportedAt: Date }>
  ): VehicleDetailResponse['boundDevice'] {
    const primaryId = v.pairedDeviceIds?.[0];
    if (!primaryId) {
      return null;
    }
    const d = deviceById.get(primaryId);
    if (!d) {
      return null;
    }
    const fs = fleetByDevice.get(d.deviceId);
    const lastSeen = effectiveLastSeen(d.lastSeenAt, fs?.reportedAt);

    return {
      deviceId: d.deviceId,
      serialNumber: d.serialNumber,
      lifecycleState: d.lifecycleState,
      lastSeenAt: lastSeen.toISOString(),
      hardwareProfile: { ...d.hardwareProfile },
      capabilityManifest: sanitizeCapabilityManifest(d.capabilityManifest),
      lastHealthMetrics: d.lastHealthMetrics
        ? { ...d.lastHealthMetrics }
        : null,
      currentRelease: d.currentRelease
        ? {
            versionIdentifier: d.currentRelease.versionIdentifier,
            installedAt: d.currentRelease.installedAt.toISOString(),
          }
        : null,
      updateState: d.updateState
        ? {
            lastCheckAt: d.updateState.lastCheckAt
              ? d.updateState.lastCheckAt.toISOString()
              : null,
            lastCheckResult: d.updateState.lastCheckResult,
            lastError: d.updateState.lastError,
          }
        : null,
    };
  }
}

function sanitizeCapabilityManifest(
  raw: CapabilityManifest | null | undefined
): CapabilityManifest | null {
  if (!raw) {
    return null;
  }
  const ra = raw.reportedAt as unknown;
  const reportedAt =
    typeof ra === 'string'
      ? ra
      : ra instanceof Date
        ? ra.toISOString()
        : '';
  return { ...raw, reportedAt };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isStaleLastSeenIso(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return true;
  }
  return Date.now() - t > 60 * 60 * 1000;
}
