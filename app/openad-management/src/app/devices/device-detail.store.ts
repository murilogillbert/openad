import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { VehicleDetailResponse } from '@openad/api-contracts';
import { InventoryService } from '../inventory/inventory.service';

@Injectable()
export class DeviceDetailStore {
  private readonly api = inject(InventoryService);

  readonly detail = signal<VehicleDetailResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  load(vehicleId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getVehicle(vehicleId).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.detail.set(null);
        this.loading.set(false);
        this.error.set(
          err instanceof HttpErrorResponse
            ? err.status === 404
              ? 'Vehicle not found.'
              : `Could not load vehicle (HTTP ${err.status}).`
            : 'Could not load vehicle.'
        );
      },
    });
  }

  replace(d: VehicleDetailResponse): void {
    this.detail.set(d);
  }
}
