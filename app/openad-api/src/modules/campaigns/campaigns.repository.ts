import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { Campaign, CampaignDocument } from './campaign.schema';

@Injectable()
export class CampaignsRepository extends AbstractRepository<CampaignDocument> {
  constructor(
    @InjectModel(Campaign.name) model: Model<CampaignDocument>
  ) {
    super(model);
  }

  async findByCampaignId(
    campaignId: string
  ): Promise<CampaignDocument | null> {
    return this.findOne({ campaignId });
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }
}
