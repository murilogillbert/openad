import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { FleetDashboardService } from '../../dashboard/fleet-dashboard.service';

/**
 * Subscribes to Socket.IO `/fleet` events (Redis pubsub:dashboard) and surfaces
 * fleet alerts, command ACKs, and report job notifications via PrimeNG toast.
 */
@Injectable({ providedIn: 'root' })
export class PortalFleetNotificationsService {
  private readonly fleet = inject(FleetDashboardService);
  private readonly messages = inject(MessageService);
  private teardown: (() => void) | null = null;

  start(): void {
    if (this.teardown) return;
    const { disconnect } = this.fleet.connectFleetSocket((data) => {
      this.handlePayload(data);
    });
    this.teardown = disconnect;
  }

  stop(): void {
    this.teardown?.();
    this.teardown = null;
  }

  private handlePayload(data: Record<string, unknown>): void {
    const kind = data['kind'];
    if (kind === 'notification') {
      this.messages.add({
        severity: 'warn',
        summary: String(data['title'] ?? 'Fleet alert'),
        detail: String(data['body'] ?? ''),
        life: 8_000,
      });
      return;
    }
    if (kind !== 'fleet_event') return;

    const type = data['type'];
    if (type === 'command_ack') {
      const status = String(data['status'] ?? '');
      this.messages.add({
        severity: status === 'success' ? 'success' : 'error',
        summary: 'Command acknowledged',
        detail: `Device ${String(data['deviceId'] ?? '')} · ${String(data['commandId'] ?? '')} (${status})`,
        life: 6_000,
      });
      return;
    }
    if (type === 'device_offline') {
      this.messages.add({
        severity: 'warn',
        summary: 'Device offline',
        detail: `Device ${String(data['deviceId'] ?? '')} marked offline (missed heartbeat).`,
        life: 8_000,
      });
      return;
    }
    if (type === 'report_ready') {
      this.messages.add({
        severity: 'success',
        summary: 'Report ready',
        detail: `Proof-of-Play job ${String(data['jobId'] ?? '')} is ready to download.`,
        life: 8_000,
      });
      return;
    }
    if (type === 'report_failed') {
      this.messages.add({
        severity: 'error',
        summary: 'Report generation failed',
        detail: String(data['errorMessage'] ?? 'Unknown error'),
        life: 8_000,
      });
    }
  }
}
