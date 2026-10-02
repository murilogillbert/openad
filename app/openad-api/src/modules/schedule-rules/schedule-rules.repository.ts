import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { ScheduleRule, ScheduleRuleDocument } from './schedule-rule.schema';

@Injectable()
export class ScheduleRulesRepository extends AbstractRepository<ScheduleRuleDocument> {
  constructor(
    @InjectModel(ScheduleRule.name) model: Model<ScheduleRuleDocument>
  ) {
    super(model);
  }

  async findByRuleId(ruleId: string): Promise<ScheduleRuleDocument | null> {
    return this.findOne({ ruleId });
  }

  async findActiveByCampaignId(
    campaignId: string
  ): Promise<ScheduleRuleDocument[]> {
    return this.findMany({ campaignId, status: 'active' });
  }

  async findActiveByGeoZoneId(zoneId: string): Promise<ScheduleRuleDocument[]> {
    return this.findMany({
      status: 'active',
      geoZoneIds: zoneId,
    });
  }
}
