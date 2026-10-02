import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { CreativeAssetsRepository } from '../campaigns/creative-assets.repository';
import { GeoZonesRepository } from '../geo-zones/geo-zones.repository';
import {
  GeoScheduleEvaluatorService,
} from './geo-schedule-evaluator.service';
import { ScheduleRulesRepository } from './schedule-rules.repository';
import type { CreateScheduleRuleBodyDto } from '../campaigns/dto/create-schedule-rule-body.dto';
import { SchedulePushService } from './schedule-push.service';

@Injectable()
export class ScheduleRuleService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly campaigns: CampaignsRepository,
    private readonly assets: CreativeAssetsRepository,
    private readonly zones: GeoZonesRepository,
    private readonly rules: ScheduleRulesRepository,
    private readonly evaluator: GeoScheduleEvaluatorService,
    private readonly schedulePush: SchedulePushService
  ) {
    this.logger.setContext(ScheduleRuleService.name);
  }

  async create(
    campaignId: string,
    dto: CreateScheduleRuleBodyDto,
    audit: FleetAuditContext
  ) {
    const campaign = await this.campaigns.findByCampaignId(campaignId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const asset = await this.assets.findByAssetId(dto.assetId);
    if (!asset || asset.campaignId !== campaignId) {
      throw new BadRequestException('assetId not found for this campaign');
    }
    if (asset.status !== 'verified') {
      throw new BadRequestException('Asset must be verified before use in a rule');
    }

    const zones = await this.zones.findByZoneIds(dto.geoZoneIds);
    if (zones.length !== dto.geoZoneIds.length) {
      throw new BadRequestException('One or more geoZoneIds were not found');
    }

    this.assertTimeWindowsNonOverlapping(dto);

    const effectivePriority = dto.priority ?? campaign.priority;
    const ruleId = randomUUID();

    this.logger.info(
      { ...audit, event: 'schedule_rule.create.attempt', campaignId, ruleId },
      'create schedule rule'
    );

    await this.rules.create({
      ruleId,
      campaignId,
      assetId: dto.assetId,
      geoZoneIds: dto.geoZoneIds,
      timeWindows: dto.timeWindows,
      dwellThresholdSeconds: dto.dwellThresholdSeconds,
      priority: effectivePriority,
      status: 'active',
    });

    const doc = await this.rules.findByRuleId(ruleId);
    if (!doc) {
      throw new InternalServerErrorException('Schedule rule not found after create');
    }
    if (campaign.status === 'active') {
      await this.schedulePush.pushForCampaign(campaignId, audit);
    }

    this.logger.info(
      { ...audit, event: 'schedule_rule.create.success', ruleId },
      'schedule rule created'
    );

    return this.serialize(doc);
  }

  private assertTimeWindowsNonOverlapping(dto: CreateScheduleRuleBodyDto): void {
    const tw = dto.timeWindows;
    for (let i = 0; i < tw.length; i++) {
      for (let j = i + 1; j < tw.length; j++) {
        if (this.evaluator.timeWindowsOverlap(tw[i], tw[j])) {
          throw new BadRequestException(
            'Time windows must not overlap for the same rule'
          );
        }
      }
    }
  }

  private serialize(doc: {
    ruleId: string;
    campaignId: string;
    assetId: string;
    geoZoneIds: string[];
    timeWindows: CreateScheduleRuleBodyDto['timeWindows'];
    dwellThresholdSeconds: number;
    priority: number | null;
    status: string;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      ruleId: doc.ruleId,
      campaignId: doc.campaignId,
      assetId: doc.assetId,
      geoZoneIds: doc.geoZoneIds,
      timeWindows: doc.timeWindows,
      dwellThresholdSeconds: doc.dwellThresholdSeconds,
      priority: doc.priority,
      status: doc.status,
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }
}
