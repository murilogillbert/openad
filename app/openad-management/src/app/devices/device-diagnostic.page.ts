import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  DeviceLifecycleEventsResponse,
  DeviceStateTransitionRequest,
} from '@openad/api-contracts';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { PortalAuthService } from '../auth/portal-auth.service';
import { formatRelativeTime } from '../inventory/inventory-relative-time';
import { InventoryService } from '../inventory/inventory.service';
import { DeviceDetailStore } from './device-detail.store';

@Component({
  selector: 'app-device-diagnostic',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TableModule,
    TagModule,
    InputTextModule,
    SelectModule,
    ProgressSpinnerModule,
    ToastModule,
  ],
  templateUrl: './device-diagnostic.page.html',
})
export class DeviceDiagnosticPage {
  protected readonly store = inject(DeviceDetailStore);
  private readonly inventory = inject(InventoryService);
  private readonly message = inject(MessageService);
  private readonly auth = inject(PortalAuthService);

  protected readonly events = signal<DeviceLifecycleEventsResponse['data']>([]);
  protected readonly eventsLoading = signal(false);
  protected readonly eventsError = signal<string | null>(null);

  protected transitionReason = '';
  protected transitionTo: DeviceStateTransitionRequest['toState'] = 'Suspended';
  protected transitionBusy = false;

  protected readonly canTransitionState = ['fleet_admin', 'super_admin'].includes(
    this.auth.getPortalUser()?.role ?? ''
  );

  protected readonly stateOptions: {
    label: string;
    value: DeviceStateTransitionRequest['toState'];
  }[] = [
    { label: 'Suspend', value: 'Suspended' },
    { label: 'Activate', value: 'Active' },
    { label: 'Retire', value: 'Retired' },
  ];

  private lastLoadedDeviceId: string | null = null;

  constructor() {
    effect(() => {
      const d = this.store.detail()?.boundDevice;
      const id = d?.deviceId ?? null;
      if (id && id !== this.lastLoadedDeviceId) {
        this.lastLoadedDeviceId = id;
        this.loadLifecycle(id);
      }
      if (!id) {
        this.lastLoadedDeviceId = null;
        this.events.set([]);
      }
    });
  }


  protected refreshLifecycle(): void {
    const id = this.store.detail()?.boundDevice?.deviceId;
    if (id) this.loadLifecycle(id);
  }

  private loadLifecycle(deviceId: string): void {
    this.eventsLoading.set(true);
    this.eventsError.set(null);
    this.inventory.getDeviceLifecycleEvents(deviceId, { limit: 50 }).subscribe({
      next: (res) => {
        this.events.set(res.data);
        this.eventsLoading.set(false);
      },
      error: (err: unknown) => {
        this.events.set([]);
        this.eventsLoading.set(false);
        this.eventsError.set(
          err instanceof HttpErrorResponse
            ? `Could not load events (HTTP ${err.status}).`
            : 'Could not load events.'
        );
      },
    });
  }

  protected relative(iso: string): string {
    return formatRelativeTime(iso);
  }

  protected applyTransition(): void {
    const deviceId = this.store.detail()?.boundDevice?.deviceId;
    if (!deviceId || this.transitionBusy) return;
    const reason = this.transitionReason.trim();
    if (!reason) {
      this.message.add({
        severity: 'warn',
        summary: 'Reason required',
        detail: 'Enter a short reason for the audit log.',
      });
      return;
    }
    this.transitionBusy = true;
    this.inventory
      .transitionDeviceState(deviceId, {
        toState: this.transitionTo,
        reason,
      })
      .subscribe({
        next: () => {
          this.transitionBusy = false;
          this.transitionReason = '';
          this.message.add({
            severity: 'success',
            summary: 'State updated',
            detail: 'Device lifecycle transition applied.',
          });
          this.store.load(this.store.detail()!.vehicleId);
          this.refreshLifecycle();
        },
        error: (err: unknown) => {
          this.transitionBusy = false;
          let msg = 'Transition failed.';
          if (err instanceof HttpErrorResponse) {
            const e = err.error as { message?: string };
            msg = e?.message ?? msg;
          }
          this.message.add({ severity: 'error', summary: 'Transition failed', detail: msg });
        },
      });
  }
}
