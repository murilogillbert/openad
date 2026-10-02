import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ConfigurationProfileResponse,
  CreateDeviceGroupRequest,
  DeviceGroupResponse,
  GroupMembershipUpdateResponse,
  Paginated,
  SyncWindowsUpdateRequest,
} from '@openad/api-contracts';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DeviceGroupsPortalService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  getGroups(page = 1, limit = 50): Observable<Paginated<DeviceGroupResponse>> {
    const params = new HttpParams()
      .set('page', String(page))
      .set('limit', String(limit));
    return this.http.get<Paginated<DeviceGroupResponse>>(
      `${this.base}/device-groups`,
      { params }
    );
  }

  getProfiles(
    page = 1,
    limit = 50
  ): Observable<Paginated<ConfigurationProfileResponse>> {
    const params = new HttpParams()
      .set('page', String(page))
      .set('limit', String(limit));
    return this.http.get<Paginated<ConfigurationProfileResponse>>(
      `${this.base}/configuration-profiles`,
      { params }
    );
  }

  createGroup(
    body: CreateDeviceGroupRequest
  ): Observable<DeviceGroupResponse> {
    return this.http.post<DeviceGroupResponse>(
      `${this.base}/device-groups`,
      body
    );
  }

  updateGroupMembers(
    groupId: string,
    deviceIds: string[]
  ): Observable<GroupMembershipUpdateResponse> {
    return this.http.patch<GroupMembershipUpdateResponse>(
      `${this.base}/device-groups/${encodeURIComponent(groupId)}/members`,
      { deviceIds }
    );
  }

  updateSyncWindows(
    groupId: string,
    body: SyncWindowsUpdateRequest
  ): Observable<DeviceGroupResponse> {
    return this.http.patch<DeviceGroupResponse>(
      `${this.base}/admin/device-groups/${encodeURIComponent(groupId)}/sync-windows`,
      body
    );
  }
}
