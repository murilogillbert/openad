import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type { VehicleBindingAuditEntry, VehicleListItem } from '@openad/api-contracts';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { catchError, of, switchMap } from 'rxjs';
import { formatRelativeTime } from '../inventory-relative-time';
import {
  vehicleBindingLabel,
  vehicleBindingSeverity,
} from '../vehicle-binding-labels';
import { InventoryService } from '../inventory.service';

@Component({
  selector: 'app-vehicle-detail',
  standalone: true,
  imports: [CommonModule, DrawerModule, ButtonModule, TagModule, TableModule],
  templateUrl: './vehicle-detail.component.html',
})
export class VehicleDetailComponent {
  readonly vehicle = input<VehicleListItem | null>(null);
  readonly dismiss = output<void>();
  readonly decommissioned = output<void>();
  /** Emitted after PATCH (e.g. in-shop) so the parent can refresh the list. */
  readonly vehicleUpdated = output<void>();

  private readonly inventory = inject(InventoryService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly message = inject(MessageService);

  protected readonly auditItems = signal<VehicleBindingAuditEntry[]>([]);

  protected readonly drawerStyle: Record<string, string> = {
    width: 'min(100vw, 440px)',
  };

  protected readonly bindingLabel = vehicleBindingLabel;
  protected readonly bindingSeverity = vehicleBindingSeverity;

  protected busy = false;
  protected inShopBusy = false;

  constructor() {
    toObservable(this.vehicle)
      .pipe(
        switchMap((v) =>
          v?.vehicleId
            ? this.inventory.listBindingAudit(v.vehicleId, { limit: 50 }).pipe(
                catchError(() => of({ items: [], nextCursor: null }))
              )
            : of({ items: [], nextCursor: null })
        ),
        takeUntilDestroyed()
      )
      .subscribe((res) => this.auditItems.set(res.items));
  }

  protected relative(iso: string): string {
    return formatRelativeTime(iso);
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.dismiss.emit();
    }
  }

  protected confirmDecommission(): void {
    const v = this.vehicle();
    if (!v || this.busy) return;
    this.confirmation.confirm({
      message: `Decommission vehicle ${v.registrationPlate}? This removes it from the active fleet catalog.`,
      header: 'Confirm decommission',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.runDecommission(v.vehicleId),
    });
  }

  protected toggleInShop(): void {
    const v = this.vehicle();
    if (!v || this.inShopBusy) return;
    this.inShopBusy = true;
    this.inventory.updateVehicle(v.vehicleId, { inShop: !v.inShop }).subscribe({
      next: () => {
        this.inShopBusy = false;
        this.message.add({
          severity: 'success',
          summary: v.inShop ? 'Marked active' : 'Marked in shop',
          detail: 'Vehicle maintenance flag was updated.',
        });
        this.vehicleUpdated.emit();
      },
      error: () => {
        this.inShopBusy = false;
        this.message.add({
          severity: 'error',
          summary: 'Update failed',
          detail: 'Could not update maintenance state.',
        });
      },
    });
  }

  protected auditActionLabel(action: VehicleBindingAuditEntry['action']): string {
    switch (action) {
      case 'pair':
        return 'Pair';
      case 'unpair':
        return 'Unpair';
      case 'decommission':
        return 'Decommission';
      case 'driver_bind':
        return 'Motorista vinculado';
      case 'driver_unbind':
        return 'Motorista desvinculado';
      default:
        return action;
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
        return 'info';
    }
  }

  private runDecommission(vehicleId: string): void {
    this.busy = true;
    this.inventory.decommissionVehicle(vehicleId).subscribe({
      next: () => {
        this.busy = false;
        this.message.add({
          severity: 'success',
          summary: 'Vehicle decommissioned',
          detail: 'The vehicle was removed from the active catalog.',
        });
        this.decommissioned.emit();
        this.dismiss.emit();
      },
      error: () => {
        this.busy = false;
        this.message.add({
          severity: 'error',
          summary: 'Decommission failed',
          detail: 'The server rejected the request or the endpoint is unavailable.',
        });
      },
    });
  }
}
