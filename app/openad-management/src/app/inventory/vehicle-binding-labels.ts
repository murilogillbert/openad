import type { VehicleBindingStatus } from '@openad/api-contracts';

export function vehicleBindingLabel(status: VehicleBindingStatus): string {
  switch (status) {
    case 'fully_operational':
      return 'Operational';
    case 'hardware_missing':
      return 'Hardware missing';
    case 'hardware_offline':
      return 'Offline / stale';
    case 'in_shop':
      return 'In shop';
    default:
      return status;
  }
}

export function vehicleBindingSeverity(
  status: VehicleBindingStatus
): 'success' | 'secondary' | 'warn' | 'danger' | 'info' | 'contrast' {
  switch (status) {
    case 'fully_operational':
      return 'success';
    case 'hardware_missing':
    case 'hardware_offline':
      return 'danger';
    case 'in_shop':
      return 'warn';
    default:
      return 'secondary';
  }
}
