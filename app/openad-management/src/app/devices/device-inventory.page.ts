import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import type { DeviceInventoryItem, DeviceListQuery } from '@openad/api-contracts';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DeviceBindDialogComponent } from '../inventory/device-bind-dialog.component';
import { formatRelativeTime } from '../inventory/inventory-relative-time';
import { InventoryService } from '../inventory/inventory.service';
import { OperationsTelemetryService } from '../operations/operations-telemetry.service';

export type DeviceLifecycleFilter =
  | 'all'
  | 'Pending'
  | 'Active'
  | 'Flagged'
  | 'Suspended'
  | 'Retired';

@Component({
  selector: 'app-device-inventory-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TableModule,
    ButtonModule,
    TagModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    DeviceBindDialogComponent,
  ],
  templateUrl: './device-inventory.page.html',
  styleUrl: './device-inventory.page.css',
})
export class DeviceInventoryPage implements OnInit {
  private readonly inventory = inject(InventoryService);
  private readonly router = inject(Router);
  private readonly opsTelemetry = inject(OperationsTelemetryService);

  protected readonly rows = signal<DeviceInventoryItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly lifecycleFilter = signal<DeviceLifecycleFilter>('all');
  protected readonly bindOpen = signal(false);

  protected readonly filterOptions: {
    label: string;
    value: DeviceLifecycleFilter;
  }[] = [
    { label: 'All lifecycles', value: 'all' },
    { label: 'Pending', value: 'Pending' },
    { label: 'Active', value: 'Active' },
    { label: 'Flagged', value: 'Flagged' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Retired', value: 'Retired' },
  ];

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const rows = this.rows();
    if (!q) {
      return rows;
    }
    return rows.filter((r) => {
      const plate = r.boundVehicleRegistrationPlate?.toLowerCase() ?? '';
      return (
        r.serialNumber.toLowerCase().includes(q) ||
        r.deviceId.toLowerCase().includes(q) ||
        plate.includes(q)
      );
    });
  });

  protected readonly kpis = computed(() => {
    const rows = this.rows();
    const total = this.total() || rows.length;
    let paired = 0;
    let offline = 0;
    let activeLifecycle = 0;
    for (const r of rows) {
      if (r.boundVehicleId) {
        paired++;
      }
      if (isStaleLastSeen(r.lastSeenAt)) {
        offline++;
      }
      if (r.lifecycleState === 'Active') {
        activeLifecycle++;
      }
    }
    return { total, paired, activeLifecycle, offline };
  });

  protected readonly displayKpis = computed(() => {
    const live = this.opsTelemetry.snapshot()?.deviceInventory;
    if (live) {
      return {
        total: live.total,
        paired: live.paired,
        activeLifecycle: live.activeLifecycle,
        offline: live.offline,
      };
    }
    return this.kpis();
  });

  ngOnInit(): void {
    this.refresh();
  }

  protected onSearchInput(ev: Event): void {
    this.search.set((ev.target as HTMLInputElement).value);
  }

  protected onLifecycleChange(ev: Event): void {
    const raw = (ev.target as HTMLSelectElement).value;
    const v = raw as DeviceLifecycleFilter;
    if (
      v === 'all' ||
      v === 'Pending' ||
      v === 'Active' ||
      v === 'Flagged' ||
      v === 'Suspended' ||
      v === 'Retired'
    ) {
      this.lifecycleFilter.set(v);
    } else {
      this.lifecycleFilter.set('all');
    }
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const query: DeviceListQuery = { page: 1, limit: 500 };
    const lf = this.lifecycleFilter();
    if (lf !== 'all') {
      query.lifecycleState = lf;
    }
    this.inventory.listDevices(query).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.total.set(res.pagination.total);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.rows.set([]);
        this.total.set(0);
        this.loading.set(false);
        this.loadError.set(
          err.status === 0
            ? 'Cannot reach the API. Start openad-api or check your connection.'
            : `Device inventory could not be loaded (HTTP ${err.status}).`
        );
      },
    });
  }

  protected relative(iso: string): string {
    return formatRelativeTime(iso);
  }

  protected severityForLifecycle(
    state: string
  ): 'success' | 'secondary' | 'warn' | 'danger' | 'info' | 'contrast' {
    switch (state) {
      case 'Active':
        return 'success';
      case 'Pending':
        return 'info';
      case 'Flagged':
        return 'warn';
      case 'Suspended':
        return 'danger';
      case 'Retired':
        return 'contrast';
      default:
        return 'secondary';
    }
  }

  protected openVehicle(vehicleId: string | null): void {
    if (!vehicleId) {
      return;
    }
    void this.router.navigate([
      '/devices',
      'vehicles',
      vehicleId,
      'overview',
    ]);
  }

  protected openProvisionDialog(): void {
    this.bindOpen.set(true);
  }

  protected onBindVisible(v: boolean): void {
    this.bindOpen.set(v);
  }

  protected onDeviceBound(): void {
    this.refresh();
  }
}

function isStaleLastSeen(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return true;
  }
  return Date.now() - t > 60 * 60 * 1000;
}
