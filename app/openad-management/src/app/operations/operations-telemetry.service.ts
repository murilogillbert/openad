import { Injectable, inject, signal } from '@angular/core';
import type { OperationsKpisPayload } from '@openad/api-contracts';
import { io, type Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { PortalAuthService } from '../auth/portal-auth.service';

/**
 * Subscribes to Socket.IO `/fleet` `operations_kpis` for live hub KPIs
 * (fleet roster, tablet inventory, pending pairing).
 */
@Injectable({ providedIn: 'root' })
export class OperationsTelemetryService {
  private readonly auth = inject(PortalAuthService);

  private socket: Socket | null = null;

  /** Latest server snapshot; null until first event or after disconnect. */
  readonly snapshot = signal<OperationsKpisPayload | null>(null);

  /** Opens websocket to API `/fleet` (same namespace as fleet map). Idempotent. */
  connect(): void {
    if (this.socket?.connected) {
      return;
    }
    const token = this.auth.getAccessToken();
    const origin = new URL(environment.apiBaseUrl).origin;
    const socket: Socket = io(`${origin}/fleet`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token: token ? `Bearer ${token}` : '' },
    });
    socket.on('operations_kpis', (payload: OperationsKpisPayload) => {
      this.snapshot.set(payload);
    });
    socket.on('connect_error', () => {
      /* keep prior snapshot; HTTP KPIs still work */
    });
    this.socket = socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.snapshot.set(null);
  }
}
