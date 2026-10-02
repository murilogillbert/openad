import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { ScheduleRulesRepository } from '../schedule-rules/schedule-rules.repository';
import { CreativeAssetsRepository } from './creative-assets.repository';
import { CampaignsRepository } from './campaigns.repository';
import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { PatchCampaignStatusDto } from './dto/patch-campaign-status.dto';
import { SchedulePushService } from '../schedule-rules/schedule-push.service';
import { MediaFolderProvisioningService } from '../media-ingestion/media-folder-provisioning.service';

@Injectable()
export class CampaignLifecycleService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly campaigns: CampaignsRepository,
    private readonly assets: CreativeAssetsRepository,
    private readonly rules: ScheduleRulesRepository,
    private readonly schedulePush: SchedulePushService,
    private readonly mediaFolders: MediaFolderProvisioningService
  ) {
    this.logger.setContext(CampaignLifecycleService.name);
  }

  async list(page = 1, limit = 50, audit?: FleetAuditContext) {
    if (audit) {
      this.logger.info(
        { ...audit, event: 'campaign.list', page, limit },
        'list campaigns'
      );
    }
    const skip = (page - 1) * limit;
    const total = await this.campaigns.countDocuments({});
    const rows = await this.campaigns.findMany(
      {},
      { skip, limit, sort: { updatedAt: -1 } }
    );
    return {
      data: rows.map((d) => this.serialize(d)),
      pagination: { total, page, limit },
    };
  }

  async create(dto: CreateCampaignDto, audit: FleetAuditContext, createdBy: string | null) {
    const campaignId = randomUUID();
    this.logger.info(
      { ...audit, event: 'campaign.create.attempt', campaignId },
      'create campaign'
    );

    const doc = await this.campaigns.create({
      campaignId,
      name: dto.name,
      advertiserName: dto.advertiserName,
      status: 'draft',
      priority: dto.priority,
      budget: dto.budget,
      scheduledStart: new Date(dto.scheduledStart),
      scheduledEnd: new Date(dto.scheduledEnd),
      createdBy,
    });

    this.logger.info(
      { ...audit, event: 'campaign.create.success', campaignId },
      'campaign created'
    );

    await this.mediaFolders.ensureCampaignFolder(campaignId, dto.name);

    return this.serialize(doc);
  }

  async patchStatus(
    campaignId: string,
    body: PatchCampaignStatusDto,
    audit: FleetAuditContext
  ) {
    const campaign = await this.campaigns.findByCampaignId(campaignId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    this.logger.info(
      {
        ...audit,
        event: 'campaign.status.attempt',
        campaignId,
        nextStatus: body.status,
      },
      'campaign status change'
    );

    if (body.status === 'active') {
      const activeRules = await this.rules.findActiveByCampaignId(campaignId);
      if (activeRules.length === 0) {
        throw new BadRequestException(
          'Campaign must have at least one active schedule rule before activation'
        );
      }
      for (const r of activeRules) {
        const asset = await this.assets.findByAssetId(r.assetId);
        if (!asset || asset.status !== 'verified') {
          throw new BadRequestException(
            'All schedule rules must reference verified assets before activation'
          );
        }
      }
    }

    const updated = await this.campaigns.updateOne(
      { campaignId },
      { $set: { status: body.status } }
    );
    if (!updated) {
      throw new NotFoundException('Campaign not found');
    }

    const next = await this.campaigns.findByCampaignId(campaignId);
    if (!next) {
      throw new NotFoundException('Campaign not found');
    }
    if (body.status === 'active') {
      await this.schedulePush.pushForCampaign(campaignId, audit);
    }

    this.logger.info(
      {
        ...audit,
        event: 'campaign.status.success',
        campaignId,
        status: body.status,
      },
      'campaign status updated'
    );

    return this.serialize(next);
  }

  private serialize(doc: {
    campaignId: string;
    name: string;
    advertiserName: string;
    status: string;
    priority: number;
    budget: { totalAmount: number; currency: string; ratePerImpression: number };
    scheduledStart: Date;
    scheduledEnd: Date;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      campaignId: doc.campaignId,
      name: doc.name,
      advertiserName: doc.advertiserName,
      status: doc.status,
      priority: doc.priority,
      budget: doc.budget,
      scheduledStart: doc.scheduledStart.toISOString(),
      scheduledEnd: doc.scheduledEnd.toISOString(),
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }
}
