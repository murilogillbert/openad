/** Live operations KPIs pushed over Socket.IO `/fleet` (`operations_kpis`). */
export interface FleetRosterKpisSnapshot {
  total: number;
  active: number;
  offline: number;
  /** Same semantics as fleet list “OTHER” (remainder after active/offline overlap correction). */
  other: number;
}

export interface DeviceInventoryKpisSnapshot {
  total: number;
  paired: number;
  activeLifecycle: number;
  offline: number;
}

export interface PendingPairingKpisSnapshot {
  inQueue: number;
  last24h: number;
  olderThan24h: number;
  /** Human-readable oldest wait (e.g. `3d ago`) or null when queue empty. */
  oldestWaitLabel: string | null;
}

export interface OperationsKpisPayload {
  fleet: FleetRosterKpisSnapshot;
  deviceInventory: DeviceInventoryKpisSnapshot;
  pendingPairing: PendingPairingKpisSnapshot;
  emittedAt: string;
}
