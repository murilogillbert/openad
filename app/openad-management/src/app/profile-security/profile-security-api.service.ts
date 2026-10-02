import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AdminChangePasswordRequest,
  AdminMePatchRequest,
  AdminMeResponse,
  AdminRevokeOtherSessionsResponse,
  AdminSessionsListResponse,
} from '@openad/api-contracts';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProfileSecurityApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  getMe(): Observable<AdminMeResponse> {
    return this.http.get<AdminMeResponse>(`${this.base}/admin/me`);
  }

  patchMe(body: AdminMePatchRequest): Observable<{ ok: true }> {
    return this.http.patch<{ ok: true }>(`${this.base}/admin/me`, body);
  }

  changePassword(body: AdminChangePasswordRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/admin/me/change-password`, body);
  }

  listSessions(): Observable<AdminSessionsListResponse> {
    return this.http.get<AdminSessionsListResponse>(`${this.base}/admin/me/sessions`);
  }

  revokeOtherSessions(): Observable<AdminRevokeOtherSessionsResponse | void> {
    return this.http.post<AdminRevokeOtherSessionsResponse | void>(
      `${this.base}/admin/me/sessions/revoke-others`,
      {}
    );
  }

  uploadPhoto(file: File): Observable<{ photoUrl: string }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<{ photoUrl: string }>(`${this.base}/admin/me/photo`, fd);
  }

  deletePhoto(): Observable<void> {
    return this.http.delete<void>(`${this.base}/admin/me/photo`);
  }
}

