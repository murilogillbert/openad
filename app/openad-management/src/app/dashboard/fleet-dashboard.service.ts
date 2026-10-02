import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type {
  FleetStatusResponse,
  IssueCommandRequest,
  RemoteCommandListResponse,
} from '@openad/api-contracts';
import { environment } from '../../environments/environment';
import { PortalAuthService } from '../auth/portal-auth.service';

@Injectable({ providedIn: 'root' })
export class FleetDashboardService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(PortalAuthService);

  getFleetStatus() {
    return this.http.get<FleetStatusResponse>(
      `${environment.apiBaseUrl}/fleet/status`
    );
  }

  issueCommand(deviceId: string, body: IssueCommandRequest) {
    return this.http.post<{
      commandId: string;
      status: string;
      expiresAt: string;
    }>(`${environment.apiBaseUrl}/admin/devices/${deviceId}/commands`, body);
  }

  listCommands(deviceId: string) {
    return this.http.get<RemoteCommandListResponse>(
      `${environment.apiBaseUrl}/admin/devices/${deviceId}/commands`
    );
  }

  connectFleetSocket(
    onEvent: (data: Record<string, unknown>) => void
  ): { socket: Socket; disconnect: () => void } {
    const token = this.auth.getAccessToken();
    const origin = new URL(environment.apiBaseUrl).origin;
    const socket = io(`${origin}/fleet`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token: token ? `Bearer ${token}` : '' },
    });
    socket.on('fleet', onEvent);
    return {
      socket,
      disconnect: () => {
        socket.disconnect();
      },
    };
  }
}
