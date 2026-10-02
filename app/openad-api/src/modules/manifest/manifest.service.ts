import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { DevicesRepository } from '../devices/devices.repository';
import type { ManifestRequestDto } from './dto/manifest-request.dto';
import type { SyncStatusDto } from './dto/sync-status.dto';
import { DeltaCalculatorService } from './generators/delta-calculator.service';
import { ManifestGeneratorService } from './generators/manifest-generator.service';
import {
  DeviceManifestSync,
  DeviceManifestSyncDocument,
} from './schemas/device-manifest-sync.schema';

@Injectable()
export class ManifestService {
  private static readonly CACHE_PREFIX = 'mm:last:';
  private static readonly CACHE_TTL_SEC = 3600;

  constructor(
    private readonly devices: DevicesRepository,
    private readonly generator: ManifestGeneratorService,
    private readonly delta: DeltaCalculatorService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    @InjectModel(DeviceManifestSync.name)
    private readonly syncModel: Model<DeviceManifestSyncDocument>,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ManifestService.name);
  }

  async getManifest(dto: ManifestRequestDto) {
    const device = await this.devices.findByDeviceId(dto.deviceId);
    if (!device) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not registered',
        },
      });
    }

    const prevKey = `${ManifestService.CACHE_PREFIX}${dto.deviceId}`;
    const prevRaw = await this.redis.get(prevKey);
    const prev = prevRaw
      ? (JSON.parse(prevRaw) as {
          deviceId: string;
          version: string;
          media: unknown[];
          spatial?: unknown;
        })
      : null;

    const genStart = process.hrtime.bigint();
    let fresh;
    try {
      fresh = await this.generator.build(dto.deviceId, dto.deviceState);
    } catch (e) {
      const sec = Number(process.hrtime.bigint() - genStart) / 1e9;
      this.metrics.manifestGenerationSeconds.observe(sec);
      throw e;
    }
    const genSec = Number(process.hrtime.bigint() - genStart) / 1e9;
    this.metrics.manifestGenerationSeconds.observe(genSec);
    if (genSec > 0.2) {
      void this.logger.warn(
        { deviceId: dto.deviceId, genMs: Math.round(genSec * 1000) },
        'manifest generation exceeded 200ms target'
      );
    }

    const next = {
      deviceId: fresh.deviceId,
      version: fresh.version,
      media: fresh.media,
      spatial: fresh.spatial,
    };

    let response: Record<string, unknown>;

    if (
      dto.lastManifestVersion &&
      prev &&
      dto.lastManifestVersion === prev.version
    ) {
      const deltaStart = process.hrtime.bigint();
      const operations = this.delta.computeDelta(
        {
          deviceId: prev.deviceId,
          version: prev.version,
          media: prev.media,
          spatial: prev.spatial ?? {
            version: prev.version,
            entries: [],
          },
        } as Record<string, unknown>,
        {
          deviceId: next.deviceId,
          version: next.version,
          media: next.media,
          spatial: next.spatial,
        } as Record<string, unknown>
      );
      const deltaSec = Number(process.hrtime.bigint() - deltaStart) / 1e9;
      this.metrics.manifestDeltaSeconds.observe(deltaSec);
      if (deltaSec > 5) {
        void this.logger.warn(
          { deviceId: dto.deviceId, deltaMs: Math.round(deltaSec * 1000) },
          'manifest delta computation exceeded 5s budget'
        );
      }
      response = {
        success: true,
        data: {
          deviceId: next.deviceId,
          version: next.version,
          previousVersion: prev.version,
          isDelta: true,
          operations,
        },
      };
    } else {
      response = {
        success: true,
        data: {
          deviceId: next.deviceId,
          version: next.version,
          isDelta: false,
          media: next.media,
          spatial: next.spatial,
        },
      };
    }

    await this.redis.set(
      prevKey,
      JSON.stringify(next),
      ManifestService.CACHE_TTL_SEC
    );

    void this.logger.debug({ deviceId: dto.deviceId }, 'manifest served');

    return response;
  }

  async recordSyncStatus(dto: SyncStatusDto): Promise<void> {
    await this.syncModel.updateOne(
      { deviceId: dto.deviceId },
      {
        $set: {
          lastManifestVersion: dto.manifestVersion,
          lastSyncedAt: new Date(dto.syncedAt),
          lastDownloadedMedia: dto.downloadedMedia,
          storageUsedBytes: dto.storageUsed,
        },
      },
      { upsert: true }
    );
  }
}
