import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { AssetIntegrityService } from './asset-integrity.service';
import { CampaignsRepository } from './campaigns.repository';
import { CreativeAssetsRepository } from './creative-assets.repository';
import type { CreativeAsset } from './creative-asset.schema';

const ALLOWED = new Set([
  'video/mp4',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class AssetUploadService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly campaigns: CampaignsRepository,
    private readonly assets: CreativeAssetsRepository,
    private readonly storage: AssetStorageService,
    private readonly integrity: AssetIntegrityService,
    @InjectQueue('asset-propagation') private readonly assetQueue: Queue
  ) {
    this.logger.setContext(AssetUploadService.name);
  }

  async saveUploadedFile(params: {
    campaignId: string;
    originalName: string;
    buffer: Buffer;
    mimeType: string;
    audit: FleetAuditContext;
    uploadedBy: string | null;
  }) {
    const campaign = await this.campaigns.findByCampaignId(params.campaignId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const normalizedMime = params.mimeType.split(';')[0].trim().toLowerCase();
    if (!ALLOWED.has(normalizedMime)) {
      throw new BadRequestException(`Unsupported mime type: ${params.mimeType}`);
    }

    const assetId = randomUUID();
    const safeName = path.basename(params.originalName || 'asset.bin');
    const storageUrl = await this.storage.saveCreativeAsset({
      campaignId: params.campaignId,
      assetId,
      safeFilename: safeName,
      buffer: params.buffer,
      mimeType: normalizedMime,
    });

    const checksumSha256 = this.integrity.sha256FromBuffer(params.buffer);

    const latest = await this.assets.findLatestByCampaignId(params.campaignId);
    const version = (latest?.version ?? 0) + 1;

    await this.assets.create({
      assetId,
      campaignId: params.campaignId,
      version,
      filename: safeName,
      mimeType: normalizedMime as CreativeAsset['mimeType'],
      fileSizeBytes: params.buffer.length,
      storageUrl,
      checksumSha256,
      status: 'pending',
      uploadedBy: params.uploadedBy,
      verifiedAt: null,
    });

    this.logger.info(
      {
        ...params.audit,
        event: 'campaign.asset.uploaded',
        campaignId: params.campaignId,
        assetId,
        version,
      },
      'creative asset stored, pending verification'
    );

    const sync =
      (process.env.SYNC_ASSET_VERIFY_IN_TESTS ?? '') === 'true';

    if (sync) {
      await this.integrity.verifyAssetFile(assetId, params.audit);
    } else {
      try {
        await this.assetQueue.add(
          'verify',
          { assetId },
          { removeOnComplete: true, removeOnFail: false }
        );
      } catch {
        await this.integrity.verifyAssetFile(assetId, params.audit);
      }
    }

    const saved = await this.assets.findByAssetId(assetId);
    return {
      assetId,
      version,
      checksumSha256,
      status: saved?.status ?? 'pending',
    };
  }
}
