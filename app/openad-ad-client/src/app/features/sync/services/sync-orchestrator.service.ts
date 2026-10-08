import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { applyPatch } from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import { DeviceSessionService } from '../../../services/device-session.service';
import { StorageManagerService as CacheIndexService } from '../../../services/storage-manager.service';
import { SYNC_LAST_MANIFEST_VERSION_KEY } from '../models/sync-state.model';
import type {
  CachedManifestDocument,
  DownloadedMediaEntry,
  ManifestMediaItem,
  ManifestSuccessResponse,
} from '../models/manifest-api.model';
import { DownloadProgressIdbService } from './download-progress-idb.service';
import { DownloadManagerService } from './download-manager.service';
import { ManifestClientService } from './manifest-client.service';
import { SyncStorageManagerService } from './storage-manager.service';
import { ManifestSyncEventsService } from './manifest-sync-events.service';
import { DeviceInfoService } from '../../../core/services/device-info.service';

const MAX_DELTA_RETRIES = 2;

/**
 * Fetches manifest (full or delta), downloads media with resume + verification, prunes removed assets, reports sync status.
 */
@Injectable()
export class SyncOrchestratorService {
  private readonly session = inject(DeviceSessionService);
  private readonly manifestClient = inject(ManifestClientService);
  private readonly downloads = inject(DownloadManagerService);
  private readonly syncStorage = inject(SyncStorageManagerService);
  private readonly idb = inject(DownloadProgressIdbService);
  private readonly cacheIndex = inject(CacheIndexService);
  private readonly manifestEvents = inject(ManifestSyncEventsService);
  private readonly deviceInfo = inject(DeviceInfoService);

  /**
   * End-to-end sync. Uses cached manifest for JSON Patch when the API returns a delta.
   */
  async syncNow(options?: { forceFull?: boolean }): Promise<void> {
    const deviceId = await this.session.getStoredDeviceId();
    const token = await this.session.getAccessToken();
    if (!deviceId || !token) {
      throw new Error('not_paired');
    }

    const { value: storedVersion } = await Preferences.get({
      key: SYNC_LAST_MANIFEST_VERSION_KEY,
    });
    const lastManifestVersion = options?.forceFull
      ? undefined
      : storedVersion ?? undefined;

    const loc = this.deviceInfo.location();
    const deviceState = loc
      ? {
          latitude: loc.latitude,
          longitude: loc.longitude,
          speed: loc.speedKmh,
          timestamp: loc.timestamp,
        }
      : { timestamp: new Date().toISOString() };

    const res = await this.manifestClient.fetchManifest({
      deviceId,
      lastManifestVersion,
      deviceState,
    });

    if (!res.success) {
      throw new Error('manifest_failed');
    }

    await this.applyManifestResponse(res, deviceId, 0);
  }

  private async applyManifestResponse(
    res: ManifestSuccessResponse,
    deviceId: string,
    depth: number
  ): Promise<void> {
    if (depth > MAX_DELTA_RETRIES) {
      throw new Error('manifest_delta_retry_exhausted');
    }

    const prevDoc = await this.idb.getCachedManifest();
    const data = res.data;

    let doc: CachedManifestDocument;

    if (data.isDelta) {
      if (!prevDoc) {
        await this.applyManifestResponse(
          await this.manifestClient.fetchManifest({
            deviceId,
            lastManifestVersion: undefined,
          }),
          deviceId,
          depth + 1
        );
        return;
      }
      const baseDoc: CachedManifestDocument =
        prevDoc.spatial != null
          ? prevDoc
          : {
              ...prevDoc,
              spatial: { version: prevDoc.version, entries: [] },
            };
      const clone = structuredClone(baseDoc) as object;
      const result = applyPatch(clone, data.operations as Operation[], true, false);
      doc = result.newDocument as CachedManifestDocument;
    } else {
      doc = {
        deviceId: data.deviceId,
        version: data.version,
        media: data.media,
        spatial: data.spatial,
      };
    }

    const prevIds = new Set(
      (prevDoc?.media ?? []).map((m) => m.mediaId)
    );
    const keepIds = new Set(doc.media.map((m) => m.mediaId));

    await this.idb.setCachedManifest(doc);

    for (const oldId of prevIds) {
      if (!keepIds.has(oldId)) {
        await this.syncStorage.deleteMediaFile(oldId);
      }
    }

    /**
     * Hash conhecido por midia na sincronizacao anterior. `mediaId` e estavel quando o
     * conteudo e substituido, entao o hash e o que diz se o arquivo local ainda serve.
     */
    const previousHashById = new Map(
      (prevDoc?.media ?? []).map((m) => [m.mediaId, m.hash] as const)
    );

    const downloaded: DownloadedMediaEntry[] = [];

    for (const item of doc.media) {
      if (await this.isAlreadyOnDisk(item, previousHashById)) {
        downloaded.push({
          mediaId: item.mediaId,
          hash: item.hash,
          verified: true,
        });
        continue;
      }
      await this.ensureSpaceWithPriorityEviction(doc, item.fileSize);
      const buf = await this.downloads.downloadVerifiedMedia({
        url: item.downloadUrl,
        mediaId: item.mediaId,
        expectedHash: item.hash,
        expectedSize: item.fileSize,
        /**
         * Renova a URL pre-assinada quando o storage responde `403`.
         *
         * A URL do manifesto vale 1 h. Um download longo (ou retomado depois de uma queda de
         * rede demorada) atravessa esse prazo, e sem renovar o tablete ficaria sem o criativo
         * ate o ciclo seguinte de sync — com os bytes ja baixados parados no IndexedDB.
         *
         * Pede o manifesto **completo** (`lastManifestVersion: undefined`): um delta nao
         * necessariamente traz esta midia, e o que precisamos aqui e so a URL nova dela.
         */
        refreshUrl: async () => {
          const atualizado = await this.manifestClient.fetchManifest({
            deviceId,
            lastManifestVersion: undefined,
          });
          /**
           * `isDelta` é o discriminante da união. Pedimos o manifesto completo, então a
           * resposta deveria ser `ManifestFullData` — mas checar em vez de afirmar é o que
           * impede um servidor que decida mandar delta de virar erro em tempo de execução
           * dentro de um `catch` de download.
           */
          if (!atualizado.success || atualizado.data.isDelta) {
            return null;
          }
          const midia = atualizado.data.media.find((m) => m.mediaId === item.mediaId);
          /**
           * Hash diferente significa que o criativo foi **substituido** no servidor. Devolver a
           * URL nova faria o download continuar de cima dos bytes do arquivo antigo, montando
           * um arquivo que nunca existiu. Melhor desistir desta tentativa: o parcial e
           * descartado na proxima, pelo hash que nao fecha.
           */
          if (!midia || midia.hash !== item.hash) {
            return null;
          }
          return midia.downloadUrl;
        },
      });
      await this.syncStorage.writeMediaFile(item.mediaId, buf);
      downloaded.push({
        mediaId: item.mediaId,
        hash: item.hash,
        verified: true,
      });
    }

    const storageUsed = doc.media.reduce((a, m) => a + m.fileSize, 0);

    await Preferences.set({
      key: SYNC_LAST_MANIFEST_VERSION_KEY,
      value: doc.version,
    });

    await this.manifestClient.reportSyncStatus({
      deviceId,
      manifestVersion: doc.version,
      syncedAt: new Date().toISOString(),
      downloadedMedia: downloaded,
      storageUsed,
    });

    this.manifestEvents.notifyManifestSynced();
  }

  /**
   * `true` quando a midia ja esta em disco com o mesmo conteudo da ultima sincronizacao.
   *
   * Dois criterios juntos: o hash do manifesto nao mudou desde a sincronizacao anterior
   * **e** o arquivo local tem exatamente o tamanho esperado. O hash sozinho nao basta
   * (o arquivo pode ter sido removido por evicao ou por `CLEAR_CACHE`); o tamanho sozinho
   * tambem nao (conteudo trocado pode ter o mesmo tamanho).
   *
   * Nao reverificamos o SHA-256 aqui de proposito: ele foi conferido no download, e
   * recalcular exigiria ler o arquivo inteiro a cada ciclo de sincronizacao.
   */
  private async isAlreadyOnDisk(
    item: ManifestMediaItem,
    previousHashById: ReadonlyMap<string, string>
  ): Promise<boolean> {
    if (previousHashById.get(item.mediaId) !== item.hash) {
      return false;
    }
    const localSize = await this.syncStorage.getMediaFileSize(item.mediaId);
    return localSize !== null && localSize === item.fileSize;
  }

  private async ensureSpaceWithPriorityEviction(
    doc: CachedManifestDocument,
    requiredBytes: number
  ): Promise<void> {
    try {
      await this.cacheIndex.ensureSpace(requiredBytes);
    } catch (e) {
      if (e instanceof Error && e.message === 'storage_full') {
        const entries = doc.media.map((m) => ({
          mediaId: m.mediaId,
          priority: m.priority,
          fileSize: m.fileSize,
        }));
        await this.syncStorage.pruneLowestPriorityFirst(entries, requiredBytes);
        await this.cacheIndex.ensureSpace(requiredBytes);
        return;
      }
      throw e;
    }
  }
}
