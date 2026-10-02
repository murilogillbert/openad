import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  FleetMapDeviceDetailResponse,
  FleetMapMetaResponse,
  FleetMapSnapshotResponse,
  IssueCommandRequest,
  IssueCommandResponse,
} from '@openad/api-contracts';
import { io, type Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PortalAuthService } from '../auth/portal-auth.service';

export interface FleetMapSnapshotQuery {
  cities?: string[];
  deviceName?: string;
  deviceStatuses?: ('online' | 'offline' | 'syncing')[];
  plates?: string;
  commercialTiers?: ('premium' | 'taxi' | 'van' | 'other')[];
  campaignIds?: string[];
}

function fleetMapQueryToSubscribeBody(
  q: FleetMapSnapshotQuery
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (q.cities?.length) body['cities'] = q.cities;
  if (q.deviceName?.trim()) body['deviceName'] = q.deviceName.trim();
  if (q.deviceStatuses?.length) body['deviceStatuses'] = q.deviceStatuses;
  if (q.plates?.trim()) body['plates'] = q.plates.trim();
  if (q.commercialTiers?.length)
    body['commercialTiers'] = q.commercialTiers;
  if (q.campaignIds?.length) body['campaignIds'] = q.campaignIds;
  return body;
}

export interface FleetMapSnapshotStreamHandle {
  disconnect: () => void;
  /** Re-send current filters (after Apply filters or reconnect). */
  pushFilters: () => void;
}

@Injectable({ providedIn: 'root' })
export class FleetMapApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(PortalAuthService);

  getMeta(): Observable<FleetMapMetaResponse> {
    return this.http.get<FleetMapMetaResponse>(
      `${environment.apiBaseUrl}/fleet/map/meta`
    );
  }

  getSnapshot(q: FleetMapSnapshotQuery): Observable<FleetMapSnapshotResponse> {
    let params = new HttpParams();
    if (q.cities?.length) params = params.set('cities', q.cities.join(','));
    if (q.deviceName?.trim())
      params = params.set('deviceName', q.deviceName.trim());
    if (q.deviceStatuses?.length)
      params = params.set('deviceStatuses', q.deviceStatuses.join(','));
    if (q.plates?.trim()) params = params.set('plates', q.plates.trim());
    if (q.commercialTiers?.length)
      params = params.set('commercialTiers', q.commercialTiers.join(','));
    if (q.campaignIds?.length)
      params = params.set('campaignIds', q.campaignIds.join(','));
    return this.http.get<FleetMapSnapshotResponse>(
      `${environment.apiBaseUrl}/fleet/map/snapshot`,
      { params }
    );
  }

  getDeviceDetail(deviceId: string): Observable<FleetMapDeviceDetailResponse> {
    return this.http.get<FleetMapDeviceDetailResponse>(
      `${environment.apiBaseUrl}/fleet/map/devices/${encodeURIComponent(deviceId)}/detail`
    );
  }

  pingDevice(deviceId: string): Observable<IssueCommandResponse> {
    const body: IssueCommandRequest = {
      type: 'EMERGENCY_SYNC',
      payload: null,
    };
    return this.http.post<IssueCommandResponse>(
      `${environment.apiBaseUrl}/fleet/devices/${encodeURIComponent(deviceId)}/commands`,
      body
    );
  }

  /**
   * Live fleet map positions + counts via Socket.IO `/fleet` (same gateway as dashboard notifications).
   * Server pushes `fleet_map_snapshot` when telemetry changes (debounced) or when filters are re-sent.
   */
  connectFleetMapSnapshotStream(options: {
    getQuery: () => FleetMapSnapshotQuery;
    onSnapshot: (snap: FleetMapSnapshotResponse) => void;
    onStreamError?: (code: string) => void;
  }): FleetMapSnapshotStreamHandle {
    const token = this.auth.getAccessToken();
    const origin = new URL(environment.apiBaseUrl).origin;
    const socket: Socket = io(`${origin}/fleet`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token: token ? `Bearer ${token}` : '' },
    });

    const emitSubscribe = (): void => {
      const body = fleetMapQueryToSubscribeBody(options.getQuery());
      socket.emit('fleet_map_subscribe', body);
    };

    socket.on('connect', () => emitSubscribe());
    socket.on('fleet_map_snapshot', (snap: FleetMapSnapshotResponse) => {
      options.onSnapshot(snap);
    });
    socket.on(
      'fleet_map_error',
      (payload: { code?: string } | undefined) => {
        options.onStreamError?.(payload?.code ?? 'unknown');
      }
    );
    socket.on('connect_error', () => {
      options.onStreamError?.('connect_error');
    });

    return {
      disconnect: () => {
        socket.emit('fleet_map_unsubscribe');
        socket.disconnect();
      },
      pushFilters: () => {
        if (socket.connected) {
          emitSubscribe();
        } else {
          socket.connect();
        }
      },
    };
  }
}
