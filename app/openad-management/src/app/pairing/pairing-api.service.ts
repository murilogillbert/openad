import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  PairingSecretResponse,
  PendingPairingListResponse,
} from '@openad/api-contracts';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PairingApiService {
  private readonly http = inject(HttpClient);

  listPending(): Observable<PendingPairingListResponse> {
    return this.http.get<PendingPairingListResponse>(
      `${environment.apiBaseUrl}/admin/devices/pending-pairings`
    );
  }

  generateSecret(deviceId: string): Observable<PairingSecretResponse> {
    return this.http.post<PairingSecretResponse>(
      `${environment.apiBaseUrl}/admin/devices/${encodeURIComponent(deviceId)}/pairing-secret`,
      {}
    );
  }
}
