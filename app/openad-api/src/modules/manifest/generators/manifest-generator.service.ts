import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import type { DeviceStateDto } from '../dto/manifest-request.dto';
import type { ManifestMediaItemDto } from '../dto/manifest-response.dto';
import {
  MediaAsset,
  MediaAssetDocument,
} from '../../media-ingestion/schemas/media-asset.schema';
import { AssetStorageService } from '../../../infrastructure/storage/asset-storage.service';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { SpatialManifestBuilderService } from './spatial-manifest-builder.service';

export interface GeneratedManifestPayload {
  deviceId: string;
  version: string;
  media: ManifestMediaItemDto[];
  spatial: { version: string; entries: SpatialEntryContract[] };
}

@Injectable()
export class ManifestGeneratorService {
  constructor(
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
    private readonly storage: AssetStorageService,
    private readonly spatialManifest: SpatialManifestBuilderService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ManifestGeneratorService.name);
  }

  async build(
    deviceId: string,
    deviceState: DeviceStateDto | undefined
  ): Promise<GeneratedManifestPayload> {
    void deviceState;
    const rows = await this.mediaModel
      .find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const media: ManifestMediaItemDto[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const downloadUrl = await this.storage.getPresignedGetUrl(
        row.storageUrl,
        3600
      );
      const item: ManifestMediaItemDto = {
        mediaId: row.mediaId,
        hash: row.hash,
        priority: 1000 - i * 10,
        downloadUrl,
        fileSize: row.fileSize,
        duration: row.duration,
      };
      if (row.campaignId) {
        item.campaignId = row.campaignId;
      }
      media.push(item);
    }

    const version = new Date().toISOString();
    void this.logger.debug({ deviceId, count: media.length }, 'manifest generated');

    const spatialBuildStarted = process.hrtime.bigint();
    const spatial = await this.spatialManifest.build();
    const spatialElapsedSec =
      Number(process.hrtime.bigint() - spatialBuildStarted) / 1e9;
    this.metrics.spatialManifestBuildSeconds.observe(spatialElapsedSec);

    return { deviceId, version, media, spatial };
  }
}
