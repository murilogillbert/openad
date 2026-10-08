import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MediaAsset, MediaAssetDocument } from '../../media-ingestion/schemas/media-asset.schema';
import { GeoZonesRepository } from '../../geo-zones/geo-zones.repository';
import type { ReconciliationStatus } from '../schemas/play-record.schema';
import { PlayRecord } from '../schemas/play-record.schema';
import { isLngLatInZone } from '../utils/play-geo.util';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';

export interface ReconcileOutcome {
  status: ReconciliationStatus;
  billable: boolean;
}

@Injectable()
export class ReconciliationService {
  constructor(
    @InjectModel(PlayRecord.name)
    private readonly playRecords: Model<PlayRecord>,
    @InjectModel(MediaAsset.name)
    private readonly mediaAssets: Model<MediaAssetDocument>,
    private readonly geoZones: GeoZonesRepository,
    private readonly cfg: PlatformConfigRuntimeService
  ) {}

  /**
   * Classify a play for tests and worker use (pure logic when durations supplied).
   */
  classifyPlay(input: {
    observedDurationSec: number;
    expectedDurationSec: number | null;
    triggerReason: string;
    geofenceOk: boolean;
    mediaId: string | null;
  }): ReconcileOutcome {
    const c = this.cfg.get().analytics;
    const ratio = c.reconFullPlayMinRatio;
    const minSec = c.reconMinDurationSec;

    if (input.triggerReason === 'Geofence_Entry') {
      if (!input.mediaId || !input.geofenceOk) {
        return { status: 'geofence_failed', billable: false };
      }
    }

    if (input.expectedDurationSec != null && input.expectedDurationSec > 0) {
      const threshold = Math.max(
        minSec,
        input.expectedDurationSec * ratio
      );
      if (input.observedDurationSec + 1e-6 < threshold) {
        return { status: 'partial', billable: false };
      }
    } else if (input.observedDurationSec + 1e-6 < minSec) {
      return { status: 'partial', billable: false };
    }

    return { status: 'billable', billable: true };
  }

  async reconcileOne(deviceId: string, uniqueEventId: string): Promise<void> {
    const doc = await this.playRecords
      .findOne({ deviceId, uniqueEventId })
      .lean()
      .exec();
    if (!doc) {
      return;
    }
    if (doc.reconciliationStatus !== 'pending') {
      return;
    }

    const start = new Date(doc.timestampStart).getTime();
    const end = new Date(doc.timestampEnd).getTime();
    const observedDurationSec = Math.max(0, (end - start) / 1000);

    let expectedDurationSec: number | null = null;
    if (doc.mediaId) {
      const asset = await this.mediaAssets
        .findOne({ mediaId: doc.mediaId })
        .lean()
        .exec();
      if (asset?.duration != null) {
        expectedDurationSec = asset.duration;
      }
    }

    const geofenceOk = await this.verifyGeofenceEntry(doc);

    const { status, billable } = this.classifyPlay({
      observedDurationSec,
      expectedDurationSec,
      triggerReason: doc.triggerReason,
      geofenceOk,
      mediaId: doc.mediaId,
    });

    /**
     * A escrita é condicionada a o registro **ainda** estar `pending`.
     *
     * A versão anterior gravava sem condição, e a leitura de `pending` lá em cima acontece
     * bem antes: entre as duas há a consulta ao asset e a verificação de geocerca. Duas coisas
     * podiam dar errado nessa janela, e as duas são silenciosas.
     *
     * Primeiro, dois trabalhadores reconciliando o mesmo registro: os dois leriam `pending`,
     * os dois gravariam, e o processor enxergaria duas transições "pendente → faturável" para
     * a mesma veiculação.
     *
     * Segundo, e pior: as regras de antifraude escrevem no mesmo documento. Um veredito de
     * fraude gravado nessa janela seria **sobrescrito** por este `$set`, e a veiculação
     * voltaria a ser faturável sem ninguém ter revisto nada.
     *
     * Com o status no filtro, a segunda escrita simplesmente não encontra documento e não faz
     * nada — que é o resultado certo.
     */
    await this.playRecords.updateOne(
      { deviceId, uniqueEventId, reconciliationStatus: 'pending' },
      { $set: { reconciliationStatus: status, billable } }
    );
  }

  /**
   * For Geofence_Entry plays, start/end must lie in an active zone that binds the media.
   */
  private async verifyGeofenceEntry(doc: {
    triggerReason: string;
    mediaId: string | null;
    vehicleId: string;
    lngStart: number;
    latStart: number;
    lngEnd: number;
    latEnd: number;
  }): Promise<boolean> {
    if (doc.triggerReason !== 'Geofence_Entry') {
      return true;
    }
    if (!doc.mediaId) {
      return false;
    }

    const zones = await this.geoZones.findZonesWithMediaBinding(doc.mediaId);
    if (zones.length === 0) {
      return false;
    }

    const candidates = zones;

    for (const zone of candidates) {
      const startOk = isLngLatInZone(
        zone.geometry,
        doc.lngStart,
        doc.latStart
      );
      const endOk = isLngLatInZone(zone.geometry, doc.lngEnd, doc.latEnd);
      if (startOk && endOk) {
        return true;
      }
    }
    return false;
  }
}
