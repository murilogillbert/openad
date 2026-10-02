import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  PlatformConfigGetResponse,
  PlatformConfigPutRequest,
  PlatformConfigRestoreDefaultsRequest,
} from '@openad/api-contracts';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PlatformConfigApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  getConfig(): Observable<PlatformConfigGetResponse> {
    return this.http.get<PlatformConfigGetResponse>(`${this.base}/platform-config`);
  }

  putConfig(body: PlatformConfigPutRequest): Observable<PlatformConfigGetResponse> {
    return this.http.put<PlatformConfigGetResponse>(`${this.base}/platform-config`, body);
  }

  restoreDefaults(
    body: PlatformConfigRestoreDefaultsRequest
  ): Observable<PlatformConfigGetResponse> {
    return this.http.put<PlatformConfigGetResponse>(
      `${this.base}/platform-config/restore-defaults`,
      body
    );
  }
}

