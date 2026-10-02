import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AppReleaseDto {
  _id: string;
  versionIdentifier: string;
  buildNumber?: number | null;
  sha256Hex?: string;
  sizeBytes?: number;
  status: string;
  createdAt?: string | null;
  artifactAccessToken?: string;
  releaseNotes?: string | null;
  uploadedByUserId?: string;
  uploadedBy?: { userId: string; displayName: string; email: string } | null;
  installedCount?: number;
  isLatestStable?: boolean;
  hasStagedRollout?: boolean;
}

export interface MdmMetricsDto {
  latestStableVersion: string | null;
  totalOnLatest: number;
  pendingNotOnLatest: number;
  openRolloutWaves: number;
}

export interface FieldReleaseNoteItemDto {
  versionIdentifier: string;
  releaseNotes: string;
  createdAt: string | null;
}

export interface RolloutDto {
  _id: string;
  releaseId: string;
  status: string;
  deviceGroupIds: string[];
  percentage: number | null;
}

export interface AdminDeviceSearchItemDto {
  deviceId: string;
  serialNumber: string;
  boundVehicleId: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReleasesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/releases`;

  listReleases(): Observable<AppReleaseDto[]> {
    return this.http.get<AppReleaseDto[]>(`${this.base}`);
  }

  getMdmMetrics(): Observable<MdmMetricsDto> {
    return this.http.get<MdmMetricsDto>(`${this.base}/metrics`);
  }

  listFieldReleaseNotes(): Observable<FieldReleaseNoteItemDto[]> {
    return this.http.get<FieldReleaseNoteItemDto[]>(`${this.base}/field-notes`);
  }

  revokeRelease(releaseId: string): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(`${this.base}/${releaseId}/revoke`, {});
  }

  uploadRelease(params: {
    file: File;
    versionIdentifier: string;
    buildNumber?: number;
    releaseNotes?: string;
  }): Observable<AppReleaseDto> {
    const fd = new FormData();
    fd.append('file', params.file, params.file.name);
    fd.append('versionIdentifier', params.versionIdentifier);
    if (params.buildNumber != null) {
      fd.append('buildNumber', String(params.buildNumber));
    }
    if (params.releaseNotes?.trim()) {
      fd.append('releaseNotes', params.releaseNotes.trim());
    }
    return this.http.post<AppReleaseDto>(`${this.base}/upload`, fd);
  }

  publishStable(releaseId: string): Observable<unknown> {
    return this.http.post(`${this.base}/${releaseId}/publish-stable`, {});
  }

  getStableManifestPublic(): Observable<unknown> {
    return this.http.get(`${environment.apiBaseUrl}/releases/public/stable-manifest`);
  }

  downloadStableCheatSheetPdf(): Observable<Blob> {
    return this.http.get(`${this.base}/stable-cheatsheet.pdf`, {
      responseType: 'blob',
    });
  }

  createRollout(
    releaseId: string,
    body: { deviceGroupIds: string[]; percentage: number | null }
  ): Observable<RolloutDto> {
    return this.http.post<RolloutDto>(
      `${this.base}/${releaseId}/rollouts`,
      body
    );
  }

  listRollouts(): Observable<RolloutDto[]> {
    return this.http.get<RolloutDto[]>(`${this.base}/rollouts/list`);
  }

  patchRollout(rolloutId: string, status: RolloutDto['status']): Observable<RolloutDto> {
    return this.http.patch<RolloutDto>(`${this.base}/rollouts/${rolloutId}`, {
      status,
    });
  }

  recordQrRegenerate(): Observable<unknown> {
    return this.http.post(`${this.base}/audit/qr-regenerate`, {});
  }

  triggerUpdateCheck(deviceId: string): Observable<{ commandId: string }> {
    return this.http.post<{ commandId: string }>(
      `${this.base}/devices/${encodeURIComponent(deviceId)}/commands/check-app-updates`,
      {}
    );
  }

  searchAdminDevices(query: string): Observable<AdminDeviceSearchItemDto[]> {
    return this.http.get<AdminDeviceSearchItemDto[]>(
      `${environment.apiBaseUrl}/admin/devices/search?q=${encodeURIComponent(query)}`
    );
  }
}
