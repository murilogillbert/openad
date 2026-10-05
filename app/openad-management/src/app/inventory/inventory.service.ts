import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateVehicleRequest,
  DeviceInventoryRegisterRequest,
  DeviceInventoryRegisterResponse,
  DeviceInventoryItem,
  DeviceLifecycleEventsResponse,
  DeviceListQuery,
  DeviceStateTransitionRequest,
  DeviceStateTransitionResponse,
  Paginated,
  VehicleBindingAuditListResponse,
  VehicleDecommissionResponse,
  VehicleDetailResponse,
  VehicleListItem,
  VehicleListQuery,
  VehicleUpdateRequest,
} from '@openad/api-contracts';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);

  listDevices(
    query: DeviceListQuery = {}
  ): Observable<Paginated<DeviceInventoryItem>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.lifecycleState) {
      params = params.set('lifecycleState', query.lifecycleState);
    }
    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }
    return this.http.get<Paginated<DeviceInventoryItem>>(
      `${environment.apiBaseUrl}/devices`,
      { params }
    );
  }

  createVehicle(body: CreateVehicleRequest): Observable<VehicleDetailResponse> {
    return this.http.post<VehicleDetailResponse>(
      `${environment.apiBaseUrl}/vehicles`,
      body
    );
  }

  listVehicles(query: VehicleListQuery = {}): Observable<Paginated<VehicleListItem>> {
    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    if (query.make) params = params.set('make', query.make);
    if (query.model) params = params.set('model', query.model);
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    return this.http.get<Paginated<VehicleListItem>>(
      `${environment.apiBaseUrl}/vehicles`,
      { params }
    );
  }

  registerInventoryDevice(
    body: DeviceInventoryRegisterRequest
  ): Observable<DeviceInventoryRegisterResponse> {
    return this.http.post<DeviceInventoryRegisterResponse>(
      `${environment.apiBaseUrl}/devices/inventory-register`,
      body
    );
  }

  /** POST /vehicles/:vehicleId/pair — link an existing tablet (008). */
  pairDevice(
    vehicleId: string,
    deviceId: string
  ): Observable<{ vehicleId: string; deviceId: string }> {
    return this.http.post<{ vehicleId: string; deviceId: string }>(
      `${environment.apiBaseUrl}/vehicles/${encodeURIComponent(vehicleId)}/pair`,
      { deviceId }
    );
  }

  /** POST /vehicles/:vehicleId/unpair */
  unpairDevice(
    vehicleId: string,
    deviceId: string
  ): Observable<{ vehicleId: string; deviceId: string }> {
    return this.http.post<{ vehicleId: string; deviceId: string }>(
      `${environment.apiBaseUrl}/vehicles/${encodeURIComponent(vehicleId)}/unpair`,
      { deviceId }
    );
  }

  decommissionVehicle(vehicleId: string): Observable<VehicleDecommissionResponse> {
    return this.http.delete<VehicleDecommissionResponse>(
      `${environment.apiBaseUrl}/vehicles/${encodeURIComponent(vehicleId)}`
    );
  }

  getVehicle(vehicleId: string): Observable<VehicleDetailResponse> {
    return this.http.get<VehicleDetailResponse>(
      `${environment.apiBaseUrl}/vehicles/${encodeURIComponent(vehicleId)}`
    );
  }

  /** GET /vehicles/:vehicleId/binding-audit — pair / unpair / decommission history (FR-011). */
  listBindingAudit(
    vehicleId: string,
    query: { limit?: number; cursor?: string; deviceId?: string } = {}
  ): Observable<VehicleBindingAuditListResponse> {
    let params = new HttpParams();
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.cursor) params = params.set('cursor', query.cursor);
    if (query.deviceId) params = params.set('deviceId', query.deviceId);
    return this.http.get<VehicleBindingAuditListResponse>(
      `${environment.apiBaseUrl}/vehicles/${encodeURIComponent(vehicleId)}/binding-audit`,
      { params }
    );
  }

  updateVehicle(
    vehicleId: string,
    body: VehicleUpdateRequest
  ): Observable<VehicleDetailResponse> {
    return this.http.patch<VehicleDetailResponse>(
      `${environment.apiBaseUrl}/vehicles/${encodeURIComponent(vehicleId)}`,
      body
    );
  }

  getDeviceLifecycleEvents(
    deviceId: string,
    query: { page?: number; limit?: number } = {}
  ): Observable<DeviceLifecycleEventsResponse> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    return this.http.get<DeviceLifecycleEventsResponse>(
      `${environment.apiBaseUrl}/devices/${encodeURIComponent(deviceId)}/lifecycle-events`,
      { params }
    );
  }

  transitionDeviceState(
    deviceId: string,
    body: DeviceStateTransitionRequest
  ): Observable<DeviceStateTransitionResponse> {
    return this.http.patch<DeviceStateTransitionResponse>(
      `${environment.apiBaseUrl}/devices/${encodeURIComponent(deviceId)}/state`,
      body
    );
  }

  /**
   * `DELETE /admin/devices/:deviceId` — remove o registro do aparelho.
   *
   * Responde 409 `DEVICE_BOUND` quando o aparelho ainda está vinculado a um veículo:
   * desvincular é ação separada e deliberada, porque apagar antes deixaria o veículo
   * apontando para um `deviceId` inexistente.
   */
  deleteDeviceRegistration(
    deviceId: string
  ): Observable<{ deviceId: string; solicitacoesRemovidas: number }> {
    return this.http.delete<{ deviceId: string; solicitacoesRemovidas: number }>(
      `${environment.apiBaseUrl}/admin/devices/${encodeURIComponent(deviceId)}`
    );
  }

  /**
   * `POST /admin/devices/:deviceId/pairing-reset` — devolve o aparelho para `Pending`.
   *
   * É o caso de campo: tablet reinstalado ou com dados limpos. Sem isto ele fica preso em
   * `Active`, e a geração de código exige `Pending`.
   */
  resetDevicePairing(
    deviceId: string
  ): Observable<{ deviceId: string; lifecycleState: 'Pending'; anterior: string }> {
    return this.http.post<{
      deviceId: string;
      lifecycleState: 'Pending';
      anterior: string;
    }>(
      `${environment.apiBaseUrl}/admin/devices/${encodeURIComponent(deviceId)}/pairing-reset`,
      {}
    );
  }
}
