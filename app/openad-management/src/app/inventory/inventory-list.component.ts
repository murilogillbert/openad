import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { VehicleListItem } from '@openad/api-contracts';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { formatRelativeTime } from './inventory-relative-time';
import {
  vehicleBindingLabel,
  vehicleBindingSeverity,
} from './vehicle-binding-labels';
import { OperationsTelemetryService } from '../operations/operations-telemetry.service';

export type FleetStatusFilter = 'all' | 'active' | 'inactive' | 'decommissioned';

@Component({
  selector: 'app-inventory-list',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    TagModule,
  ],
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.css',
})
export class InventoryListComponent {
  private readonly opsTelemetry = inject(OperationsTelemetryService);

  readonly vehicles = input.required<VehicleListItem[]>();
  readonly loading = input(false);
  readonly loadError = input<string | null>(null);
  readonly totalCount = input(0);

  readonly statusFilter = input<FleetStatusFilter>('all');
  readonly statusFilterChange = output<FleetStatusFilter>();
  readonly viewVehicle = output<VehicleListItem>();
  readonly addVehicle = output<void>();

  protected readonly filterOptions: { label: string; value: FleetStatusFilter }[] = [
    { label: 'All statuses', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Decommissioned', value: 'decommissioned' },
  ];

  protected search = signal('');

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const rows = this.vehicles();
    if (!q) return rows;
    return rows.filter(
      (v) =>
        v.registrationPlate.toLowerCase().includes(q) ||
        v.vehicleId.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q)
    );
  });

  protected readonly kpis = computed(() => {
    const rows = this.vehicles();
    const total = this.totalCount() || rows.length;
    const active = rows.filter((v) => v.status === 'active').length;
    const offline = rows.filter(
      (v) => !v.boundDevice || isStale(v.boundDevice.lastSeenAt)
    ).length;
    const syncing = Math.max(0, rows.length - active - offline);
    return { total, active, offline, syncing };
  });

  /** Live `/fleet` `operations_kpis` when connected; else REST-derived {@link kpis}. */
  protected readonly displayKpis = computed(() => {
    const live = this.opsTelemetry.snapshot()?.fleet;
    if (live) {
      return {
        total: live.total,
        active: live.active,
        offline: live.offline,
        syncing: live.other,
      };
    }
    return this.kpis();
  });

  protected relative(iso: string): string {
    return formatRelativeTime(iso);
  }

  protected onSearchFromInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.search.set(v);
  }

  protected onFleetStatusChange(ev: Event): void {
    const raw = (ev.target as HTMLSelectElement).value;
    const v = raw as FleetStatusFilter;
    if (v === 'all' || v === 'active' || v === 'inactive' || v === 'decommissioned') {
      this.statusFilterChange.emit(v);
    } else {
      this.statusFilterChange.emit('all');
    }
  }

  protected severityForStatus(
    status: string
  ): 'success' | 'secondary' | 'warn' | 'danger' | 'info' | 'contrast' {
    switch (status.toLowerCase()) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'warn';
      case 'decommissioned':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  protected tierLabel(v: VehicleListItem): string {
    const m = v.make?.trim();
    if (!m) return 'Standard';
    return m.length <= 12 ? m : `${m.slice(0, 10)}…`;
  }

  protected readonly bindingLabel = vehicleBindingLabel;
  protected readonly bindingSeverity = vehicleBindingSeverity;

  protected tabletCount(v: VehicleListItem): string {
    const n = v.pairedDeviceIds?.length ?? 0;
    if (n === 0) return 'None';
    if (n === 1) return '1 tablet';
    return `${n} tablets`;
  }
}

function isStale(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > 60 * 60 * 1000;
}
