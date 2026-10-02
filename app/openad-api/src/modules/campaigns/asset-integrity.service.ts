import { createHash } from 'crypto';
import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { CreativeAssetsRepository } from './creative-assets.repository';

@Injectable()
export class AssetIntegrityService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly assets: CreativeAssetsRepository,
    private readonly storage: AssetStorageService
  ) {
    this.logger.setContext(AssetIntegrityService.name);
  }

  sha256FromBuffer(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }

  async verifyAssetFile(assetId: string, audit: FleetAuditContext): Promise<void> {
    const asset = await this.assets.findByAssetId(assetId);
    if (!asset) {
      this.logger.warn(
        { ...audit, event: 'asset.integrity.skip', assetId, reason: 'not_found' },
        'asset not found for integrity check'
      );
      return;
    }

    let data: Buffer;
    try {
      data = await this.storage.readBuffer(asset.storageUrl);
    } catch (e) {
      this.logger.error(
        {
          ...audit,
          event: 'asset.integrity.failed',
          assetId,
          err: String(e),
        },
        'failed to read asset file'
      );
      throw new InternalServerErrorException('Asset file missing on disk');
    }

    const computed = this.sha256FromBuffer(data);
    const ok = computed === asset.checksumSha256;

    await this.assets.updateOne(
      { assetId },
      {
        $set: {
          status: ok ? 'verified' : 'rejected',
          verifiedAt: ok ? new Date() : null,
        },
      }
    );

    this.logger.info(
      {
        ...audit,
        event: ok ? 'asset.integrity.verified' : 'asset.integrity.rejected',
        assetId,
        campaignId: asset.campaignId,
      },
      ok ? 'asset verified' : 'asset rejected (checksum mismatch)'
    );
  }
}
