import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { CreativeAsset, CreativeAssetDocument } from './creative-asset.schema';

@Injectable()
export class CreativeAssetsRepository extends AbstractRepository<CreativeAssetDocument> {
  constructor(
    @InjectModel(CreativeAsset.name) model: Model<CreativeAssetDocument>
  ) {
    super(model);
  }

  async findByAssetId(assetId: string): Promise<CreativeAssetDocument | null> {
    return this.findOne({ assetId });
  }

  async findLatestByCampaignId(
    campaignId: string
  ): Promise<CreativeAssetDocument | null> {
    const [doc] = await this.model
      .find({ campaignId })
      .sort({ version: -1 })
      .limit(1)
      .exec();
    return doc ?? null;
  }
}
