import { Injectable, inject } from '@angular/core';
import { ApiClientService } from '../../../services/api-client.service';
import type {
  ManifestRequestBody,
  ManifestSuccessResponse,
  SyncStatusBody,
} from '../models/manifest-api.model';

/**
 * Cliente do manifesto de midia.
 *
 * Os caminhos vao **sem** `/api/v1`: `API_BASE_URL` ja carrega esse prefixo. Com ele repetido,
 * a URL virava `https://adsapi.opendriver.com.br/api/v1/api/v1/manifest` e o servidor
 * respondia 404 `Cannot POST /api/v1/api/v1/manifest` — o tablete nunca recebia conteudo e
 * ficava com a tela vazia, mesmo com campanha ativa e criativo aprovado.
 */
@Injectable()
export class ManifestClientService {
  private readonly api = inject(ApiClientService);

  fetchManifest(body: ManifestRequestBody): Promise<ManifestSuccessResponse> {
    return this.api.postWithAuth<ManifestSuccessResponse>('/manifest', body);
  }

  reportSyncStatus(body: SyncStatusBody): Promise<unknown> {
    return this.api.postWithAuth<unknown>('/manifest/sync-status', body);
  }
}
