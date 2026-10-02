import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { VehicleListItem, VehicleListQuery } from '@openad/api-contracts';
import { AddVehicleDialogComponent } from '../inventory/add-vehicle-dialog.component';
import {
  FleetStatusFilter,
  InventoryListComponent,
} from '../inventory/inventory-list.component';
import { InventoryService } from '../inventory/inventory.service';
@Component({
  selector: 'app-inventory-page',
  standalone: true,
  imports: [InventoryListComponent, AddVehicleDialogComponent],
  templateUrl: './inventory.page.html',
})
export class InventoryPage implements OnInit {
  private readonly inventory = inject(InventoryService);
  private readonly router = inject(Router);

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly statusFilter = signal<FleetStatusFilter>('all');
  protected readonly addVehicleOpen = signal(false);

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const s = this.statusFilter();
    const query: VehicleListQuery = { limit: 500 };
    if (s !== 'all') {
      query.status = s;
    }
    this.inventory.listVehicles(query).subscribe({
      next: (res) => {
        this.vehicles.set(res.data);
        this.totalCount.set(res.pagination.total);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.vehicles.set([]);
        this.totalCount.set(0);
        this.loadError.set(
          err.status === 0
            ? 'Cannot reach the API. Start openad-api on port 3000 or check your connection.'
            : `Fleet catalog could not be loaded (HTTP ${err.status}).`
        );
      },
    });
  }

  protected onStatusFilter(next: FleetStatusFilter): void {
    this.statusFilter.set(next);
    this.refresh();
  }

  protected onViewVehicle(v: VehicleListItem): void {
    void this.router.navigate([
      '/devices',
      'vehicles',
      v.vehicleId,
      'overview',
    ]);
  }

  protected onAddVehicle(): void {
    this.addVehicleOpen.set(true);
  }

  protected onVehicleCreated(): void {
    this.refresh();
  }
}
