import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { PortalAuthService } from '../auth/portal-auth.service';
import { formatRelativeTime } from '../inventory/inventory-relative-time';
import {
  vehicleBindingLabel,
  vehicleBindingSeverity,
} from '../inventory/vehicle-binding-labels';
import { InventoryService } from '../inventory/inventory.service';
import { ReleasesApiService } from '../releases/releases-api.service';
import { DeviceDetailStore } from './device-detail.store';

@Component({
  selector: 'app-device-overview',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    CardModule,
    TagModule,
    ProgressSpinnerModule,
    ConfirmDialogModule,
    ToastModule,
  ],
  templateUrl: './device-overview.page.html',
})
export class DeviceOverviewPage {
  protected readonly bindingLabel = vehicleBindingLabel;
  protected readonly bindingSeverity = vehicleBindingSeverity;

  protected readonly store = inject(DeviceDetailStore);
  private readonly inventory = inject(InventoryService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly message = inject(MessageService);
  private readonly auth = inject(PortalAuthService);
  private readonly releases = inject(ReleasesApiService);

  protected readonly canDecommission =
    this.auth.getPortalUser()?.role === 'fleet_admin';

  protected readonly canForceUpdate =
    this.auth.getPortalUser()?.role === 'super_admin';

  protected busy = false;
  protected forceBusy = false;

  protected relative(iso: string): string {
    return formatRelativeTime(iso);
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

  protected confirmDecommission(): void {
    const v = this.store.detail();
    if (!v || this.busy || v.status === 'decommissioned') return;
    this.confirmation.confirm({
      message: `Decommission ${v.registrationPlate}? This removes it from the active fleet catalog.`,
      header: 'Confirm decommission',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.runDecommission(v.vehicleId),
    });
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
        this.store.load(vehicleId);
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

  protected confirmForceUpdate(): void {
    const v = this.store.detail();
    const deviceId = v?.boundDevice?.deviceId ?? null;
    if (!deviceId || !this.canForceUpdate || this.forceBusy) return;
    this.confirmation.confirm({
      message:
        'Force this tablet to check for updates right now? This bypasses the normal overnight schedule.',
      header: 'Force update check',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.runForceUpdate(deviceId),
    });
  }

  private runForceUpdate(deviceId: string): void {
    this.forceBusy = true;
    this.releases.triggerUpdateCheck(deviceId).subscribe({
      next: (r) => {
        this.forceBusy = false;
        this.message.add({
          severity: 'success',
          summary: 'Update check triggered',
          detail: `commandId=${r.commandId}`,
        });
      },
      error: () => {
        this.forceBusy = false;
        this.message.add({
          severity: 'error',
          summary: 'Force update check failed',
          detail: 'The server rejected the request or the endpoint is unavailable.',
        });
      },
    });
  }
}
