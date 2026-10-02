import { Injectable } from '@nestjs/common';
import type { OperationsKpisPayload } from '@openad/api-contracts';
import { DevicesRepository } from '../devices/devices.repository';
import { VehiclesQueryService } from '../vehicles/vehicles-query.service';

const OFFLINE_MS = 60 * 60 * 1000;

@Injectable()
export class OperationsKpisService {
  constructor(
    private readonly vehiclesQuery: VehiclesQueryService,
    private readonly devices: DevicesRepository
  ) {}

  async getSnapshot(): Promise<OperationsKpisPayload> {
    const [fleet, deviceInventory, pendingPairing] = await Promise.all([
      this.vehiclesQuery.computeFleetRosterKpis(),
      this.computeDeviceInventoryKpis(),
      this.computePendingPairingKpis(),
    ]);
    return {
      fleet,
      deviceInventory,
      pendingPairing,
      emittedAt: new Date().toISOString(),
    };
  }

  private async computeDeviceInventoryKpis(): Promise<
    OperationsKpisPayload['deviceInventory']
  > {
    const oneHourAgo = new Date(Date.now() - OFFLINE_MS);
    const [total, paired, activeLifecycle, offline] = await Promise.all([
      this.devices.countDocuments({}),
      this.devices.countDocuments({ boundVehicleId: { $ne: null } }),
      this.devices.countDocuments({ lifecycleState: 'Active' }),
      this.devices.countDocuments({ lastSeenAt: { $lt: oneHourAgo } }),
    ]);
    return { total, paired, activeLifecycle, offline };
  }

  private async computePendingPairingKpis(): Promise<
    OperationsKpisPayload['pendingPairing']
  > {
    const pending = await this.devices.findPendingPairing(5000);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let last24h = 0;
    let olderThan24h = 0;
    let oldestMs = Infinity;
    for (const p of pending) {
      const c = p.createdAt?.getTime();
      if (c == null || Number.isNaN(c)) {
        continue;
      }
      oldestMs = Math.min(oldestMs, c);
      if (now - c <= dayMs) {
        last24h++;
      } else {
        olderThan24h++;
      }
    }
    const oldestWaitLabel =
      pending.length === 0 || oldestMs === Infinity
        ? null
        : formatCompactRelative(new Date(oldestMs).toISOString());
    return {
      inQueue: pending.length,
      last24h,
      olderThan24h,
      oldestWaitLabel,
    };
  }
}

function formatCompactRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '—';
  }
  const diffMs = Date.now() - then;
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
