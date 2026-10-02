import { Injectable, inject } from '@angular/core';
import { ApiClientService } from '../../../services/api-client.service';
import type {
  ManifestRequestBody,
  ManifestSuccessResponse,
  SyncStatusBody,
} from '../models/manifest-api.model';

@Injectable()
export class ManifestClientService {
  private readonly api = inject(ApiClientService);

  fetchManifest(body: ManifestRequestBody): Promise<ManifestSuccessResponse> {
    return this.api.postWithAuth<ManifestSuccessResponse>(
      '/api/v1/manifest',
      body
    );
  }

  reportSyncStatus(body: SyncStatusBody): Promise<unknown> {
    return this.api.postWithAuth<unknown>('/api/v1/manifest/sync-status', body);
  }
}
