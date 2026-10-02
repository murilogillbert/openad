import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PinoLogger } from 'nestjs-pino';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { Model } from 'mongoose';
import { PacingSignalService } from '../../analytics/services/pacing-signal.service';
import { GeoZonesRepository } from '../../geo-zones/geo-zones.repository';
import type { GeoZone } from '../../geo-zones/geo-zone.schema';
import {
  MediaAsset,
  MediaAssetDocument,
} from '../../media-ingestion/schemas/media-asset.schema';

@Injectable()
export class SpatialManifestBuilderService {
  constructor(
    private readonly zones: GeoZonesRepository,
    private readonly logger: PinoLogger,
    @InjectModel(MediaAsset.name)
    private readonly mediaAssets: Model<MediaAssetDocument>,
    private readonly pacing: PacingSignalService
  ) {
    this.logger.setContext(SpatialManifestBuilderService.name);
  }

  async build(): Promise<{ version: string; entries: SpatialEntryContract[] }> {
    const start = process.hrtime.bigint();
    const rows = await this.zones.findMany(
      { $or: [{ isActive: true }, { isActive: { $exists: false } }] },
      { sort: { priorityScore: -1 } }
    );
    const entries: SpatialEntryContract[] = [];
    for (const z of rows) {
      if (z.isActive === false) continue;
      const bindings = z.bindings ?? [];
      for (const b of bindings) {
        const geometry = mapGeometry(z.geometry);
        if (!geometry) continue;
        const basePf = b.pacingFactor ?? 1;
        let deliveryMul = 1;
        const asset = await this.mediaAssets
          .findOne({ mediaId: b.mediaId })
          .lean()
          .exec();
        const cid = asset?.campaignId;
        if (typeof cid === 'string' && cid.length > 0) {
          deliveryMul = await this.pacing.getPacingDeliveryMultiplier(cid);
        }
        const pacingFactor = basePf * deliveryMul;
        const trigger: { mode: 'entry' | 'dwell'; dwellSeconds?: number } = {
          mode: b.triggerMode,
        };
        if (b.triggerMode === 'dwell' && b.dwellSeconds != null) {
          trigger.dwellSeconds = b.dwellSeconds;
        }
        const entry: SpatialEntryContract = {
          zoneId: z.zoneId,
          tier: z.tier ?? 'T4',
          priorityScore: z.priorityScore ?? 0,
          geometry,
          mediaId: b.mediaId,
          trigger,
          rotation: b.rotationMode,
          arbitration: {
            pacingFactor,
            weights: {
              p: b.arbitrationWeights?.wp ?? 1,
              d: b.arbitrationWeights?.wd ?? 1,
              h: b.arbitrationWeights?.wh ?? 1,
            },
          },
          hysteresisExitMeters: z.bufferExitMeters,
          cooldownSeconds: b.retriggerCooldownSeconds,
        };
        if (b.epicenter) {
          entry.epicenter = b.epicenter;
        }
        if (b.velocityMaxKmh != null || b.velocityMinKmh != null) {
          entry.velocity = {};
          if (b.velocityMaxKmh != null) {
            entry.velocity.maxKmhSilence = b.velocityMaxKmh;
          }
          if (b.velocityMinKmh != null) {
            entry.velocity.minKmhDwell = b.velocityMinKmh;
          }
        }
        entries.push(entry);
      }
    }
    const version = new Date().toISOString();
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    void this.logger.info(
      { entryCount: entries.length, buildMs: Math.round(sec * 1000) },
      'spatial manifest built'
    );
    return { version, entries };
  }
}

function mapGeometry(
  geometry: GeoZone['geometry']
): SpatialEntryContract['geometry'] | null {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates,
    };
  }
  if (geometry.type === 'Circle') {
    return {
      type: 'Circle',
      center: geometry.center,
      radiusMeters: geometry.radiusMeters,
    };
  }
  return null;
}
