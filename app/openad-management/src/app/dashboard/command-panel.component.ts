import {
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import type { RemoteCommandListItem } from '@openad/api-contracts';
import { FleetDashboardService } from './fleet-dashboard.service';

function payloadForType(
  type: RemoteCommandListItem['type']
): Record<string, unknown> | null {
  switch (type) {
    case 'UPGRADE_APP':
      return {
        apkUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      };
    case 'SET_VOLUME':
    case 'SET_BRIGHTNESS':
      return { level: 50 };
    case 'TEMP_DISABLE_KIOSK':
      return { durationSeconds: 300 };
    default:
      return null;
  }
}

const COMMAND_TYPES: {
  label: string;
  value: RemoteCommandListItem['type'];
}[] = [
  { label: 'Restart', value: 'RESTART' },
  { label: 'Sync schedule', value: 'SYNC_SCHEDULE' },
  { label: 'Clear cache', value: 'CLEAR_CACHE' },
  { label: 'Screenshot', value: 'GET_SCREENSHOT' },
  { label: 'Upgrade app', value: 'UPGRADE_APP' },
  { label: 'Volume', value: 'SET_VOLUME' },
  { label: 'Brightness', value: 'SET_BRIGHTNESS' },
  { label: 'Emergency sync', value: 'EMERGENCY_SYNC' },
  { label: 'Temporarily disable kiosk (5 min)', value: 'TEMP_DISABLE_KIOSK' },
  { label: 'Custom', value: 'CUSTOM' },
];

@Component({
  selector: 'app-command-panel',
  standalone: true,
  imports: [FormsModule, ButtonModule, SelectModule, TagModule],
  template: `
    <div
      class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900/60"
    >
      <h2 class="app-font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
        Remote commands
      </h2>
      @if (!deviceId()) {
        <p class="mt-2 text-sm text-slate-500">
          Select a vehicle on the map to issue commands or view history.
        </p>
      } @else {
        <p class="mt-1 font-mono text-xs text-slate-500">{{ deviceId() }}</p>

        <div class="mt-4 space-y-3">
          <label
            for="cmd-type"
            class="block text-xs font-medium text-slate-600 dark:text-slate-400"
            >Command</label
          >
          <p-select
            inputId="cmd-type"
            class="w-full"
            [options]="commandTypes"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="selectedType"
          />
          <button
            pButton
            type="button"
            class="w-full"
            [disabled]="submitting()"
            (click)="submit()"
          >
            {{ submitting() ? 'Sending…' : 'Send command' }}
          </button>
          @if (panelError()) {
            <p class="text-sm text-red-600 dark:text-red-400">{{ panelError() }}</p>
          }
          @if (successMsg()) {
            <p class="text-sm text-emerald-700 dark:text-emerald-300">
              {{ successMsg() }}
            </p>
          }
        </div>

        <div class="mt-6 border-t border-slate-200 pt-4 dark:border-slate-600">
          <h3 class="text-sm font-medium text-slate-700 dark:text-slate-300">
            Recent commands
          </h3>
          @if (loadingList()) {
            <p class="mt-2 text-sm text-slate-500">Loading…</p>
          } @else if (commands().length === 0) {
            <p class="mt-2 text-sm text-slate-500">No commands yet.</p>
          } @else {
            <ul class="mt-2 max-h-48 space-y-2 overflow-y-auto text-sm">
              @for (c of commands(); track c.commandId) {
                <li
                  class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/80"
                >
                  <span class="font-mono text-xs text-slate-600 dark:text-slate-400">{{
                    c.type
                  }}</span>
                  <div class="flex items-center gap-2">
                    @if (c.screenshotUrl) {
                      <a
                        [href]="c.screenshotUrl"
                        target="_blank"
                        rel="noopener"
                        class="text-xs font-medium text-primary hover:underline"
                        >View screenshot</a
                      >
                    }
                    <p-tag [value]="c.status" [severity]="severity(c.status)" />
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      }
    </div>
  `,
})
export class CommandPanelComponent {
  private readonly fleet = inject(FleetDashboardService);

  readonly deviceId = input<string | null>(null);

  readonly commandTypes = COMMAND_TYPES;
  selectedType: RemoteCommandListItem['type'] = 'RESTART';

  readonly commands = signal<RemoteCommandListItem[]>([]);
  readonly loadingList = signal(false);
  readonly submitting = signal(false);
  readonly panelError = signal<string | null>(null);
  readonly successMsg = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.deviceId();
      this.panelError.set(null);
      this.successMsg.set(null);
      if (!id) {
        this.commands.set([]);
        return;
      }
      this.refreshList(id);
    });
  }

  private refreshList(deviceId: string): void {
    this.loadingList.set(true);
    this.fleet.listCommands(deviceId).subscribe({
      next: (res) => {
        this.commands.set(res.data);
        this.loadingList.set(false);
      },
      error: () => {
        this.loadingList.set(false);
        this.commands.set([]);
        this.panelError.set(
          'Cannot load command history (fleet_admin role required).'
        );
      },
    });
  }

  submit(): void {
    const id = this.deviceId();
    if (!id) return;
    this.submitting.set(true);
    this.panelError.set(null);
    this.successMsg.set(null);
    this.fleet
      .issueCommand(id, {
        type: this.selectedType,
        payload: payloadForType(this.selectedType),
      })
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.successMsg.set(`Queued command ${res.commandId.slice(0, 8)}…`);
          this.refreshList(id);
        },
        error: () => {
          this.submitting.set(false);
          this.panelError.set(
            'Command rejected. Sign in as fleet_admin to issue remote commands.'
          );
        },
      });
  }

  severity(
    status: RemoteCommandListItem['status']
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | null {
    switch (status) {
      case 'Acknowledged':
      case 'acknowledged':
        return 'success';
      case 'Delivered':
      case 'dispatched':
        return 'info';
      case 'Pending':
      case 'queued':
        return 'warn';
      case 'Acknowledged_Failure':
      case 'Failed':
      case 'failed':
        return 'danger';
      case 'Expired':
        return 'secondary';
      default:
        return 'secondary';
    }
  }
}
