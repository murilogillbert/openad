import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import {
  ReleasesApiService,
  type AdminDeviceSearchItemDto,
} from './releases-api.service';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  switchMap,
} from 'rxjs';

@Component({
  selector: 'app-releases-operator-tools',
  standalone: true,
  imports: [CommonModule, FormsModule, ToastModule, SelectModule],
  providers: [MessageService],
  template: `
    <p-toast />
    <section
      class="rounded-xl border border-surface-200 bg-surface-0 p-4 shadow-sm dark:border-surface-300 dark:bg-surface-100"
    >
      <h2 class="mb-1 text-sm font-bold text-color">Remote: check for updates</h2>
      <p class="mb-3 text-xs text-muted-color">Send a one-shot MQTT command so a device fetches the latest app policies.</p>
      <div class="flex flex-wrap items-end gap-2 text-sm">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-xs font-medium text-color">Device</span>
          <p-select
            class="w-full min-w-0"
            styleClass="w-full min-w-0"
            [options]="deviceOptions"
            optionLabel="label"
            optionValue="deviceId"
            [filter]="true"
            [loading]="deviceLoading"
            [resetFilterOnHide]="true"
            placeholder="Search by device id or serial number"
            emptyFilterMessage="No matches — try another serial or UUID fragment"
            (onShow)="onDevicePanelShow()"
            (onFilter)="onDeviceFilter($event)"
            [(ngModel)]="commandDeviceId"
          />
        </label>
        <button
          type="button"
          class="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-violet-500"
          (click)="sendUpdateCommand()"
          [disabled]="!commandDeviceId"
        >
          Send command
        </button>
      </div>
    </section>
  `,
})
export class ReleasesOperatorToolsComponent {
  private readonly api = inject(ReleasesApiService);
  private readonly messages = inject(MessageService);

  protected commandDeviceId = '';
  protected deviceLoading = false;
  protected deviceOptions: Array<{
    label: string;
    deviceId: string;
    serialNumber: string;
    boundVehicleId: string | null;
  }> = [];

  private readonly search$ = new Subject<string>();

  constructor() {
    this.search$
      .pipe(
        debounceTime(150),
        distinctUntilChanged(),
        switchMap((q) => {
          const query = q.trim();
          if (query.length < 2) {
            return of([] as AdminDeviceSearchItemDto[]);
          }
          this.deviceLoading = true;
          return this.api.searchAdminDevices(query).pipe(
            finalize(() => (this.deviceLoading = false))
          );
        }),
        map((rows) =>
          (rows ?? []).map((d) => ({
            deviceId: d.deviceId,
            serialNumber: d.serialNumber,
            boundVehicleId: d.boundVehicleId,
            label: d.boundVehicleId
              ? `${d.serialNumber} · ${d.deviceId} · vehicle ${d.boundVehicleId}`
              : `${d.serialNumber} · ${d.deviceId}`,
          }))
        )
      )
      .subscribe({
        next: (opts) => {
          this.deviceOptions = opts;
        },
        error: () => {
          this.deviceOptions = [];
          this.deviceLoading = false;
        },
      });
  }

  protected onDevicePanelShow(): void {
    this.search$.next('');
  }

  protected onDeviceFilter(ev: { filter?: string | null }): void {
    const f = ev?.filter;
    this.search$.next(typeof f === 'string' ? f : '');
  }

  sendUpdateCommand(): void {
    const id = this.commandDeviceId.trim();
    if (!id) {
      return;
    }
    this.api.triggerUpdateCheck(id).subscribe({
      next: (r) => {
        this.messages.add({
          severity: 'success',
          summary: 'Command sent',
          detail: `commandId=${r.commandId}`,
        });
      },
      error: (e: HttpErrorResponse) => {
        this.messages.add({
          severity: 'error',
          summary: 'Command failed',
          detail: e.error?.message ?? e.message,
        });
      },
    });
  }
}
