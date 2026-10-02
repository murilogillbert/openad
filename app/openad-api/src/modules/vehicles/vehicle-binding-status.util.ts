/**
 * Derives vehicle-level binding status for roster/detail (008).
 *
 * **Missing / ambiguous device heartbeat**: if a `pairedDeviceIds` entry has no
 * matching `devices` document (or no usable `lastSeenAt`), treat effective
 * freshness as stale → contributes to **hardware_offline** (same as >1h offline),
 * unless **in_shop** overrides presentation.
 */
import type { VehicleBindingStatus } from '@openad/api-contracts';

const OFFLINE_MS = 60 * 60 * 1000;

export function deriveVehicleBindingStatus(input: {
  inShop: boolean;
  pairedDeviceIds: string[];
  /** Effective last-seen per paired device (ISO or Date); missing key → offline. */
  lastSeenByDeviceId: Map<string, Date>;
}): VehicleBindingStatus {
  if (input.inShop) {
    return 'in_shop';
  }
  const paired = input.pairedDeviceIds ?? [];
  if (paired.length === 0) {
    return 'hardware_missing';
  }
  const now = Date.now();
  for (const id of paired) {
    const t = input.lastSeenByDeviceId.get(id);
    if (!t || now - t.getTime() > OFFLINE_MS) {
      return 'hardware_offline';
    }
  }
  return 'fully_operational';
}

export function effectiveLastSeen(
  deviceLastSeen: Date,
  fleetReportedAt?: Date | null
): Date {
  if (!fleetReportedAt) return deviceLastSeen;
  return fleetReportedAt > deviceLastSeen ? fleetReportedAt : deviceLastSeen;
}
