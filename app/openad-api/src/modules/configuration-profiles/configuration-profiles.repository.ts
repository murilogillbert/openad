import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import {
  ConfigurationProfile,
  ConfigurationProfileDocument,
} from './configuration-profile.schema';

export interface ProfilePagination {
  page?: number;
  limit?: number;
}

@Injectable()
export class ConfigurationProfilesRepository extends AbstractRepository<ConfigurationProfileDocument> {
  constructor(
    @InjectModel(ConfigurationProfile.name)
    model: Model<ConfigurationProfileDocument>
  ) {
    super(model);
  }

  async findAll(
    pagination?: ProfilePagination
  ): Promise<{ data: ConfigurationProfileDocument[]; total: number }> {
    const page = Math.max(1, pagination?.page ?? 1);
    const limit = Math.min(pagination?.limit ?? 50, 500);
    const [data, total] = await Promise.all([
      this.model
        .find()
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments().exec(),
    ]);
    return { data, total };
  }

  async findById(
    profileId: string
  ): Promise<ConfigurationProfileDocument | null> {
    return this.findOne({ profileId });
  }

  async findByName(
    name: string
  ): Promise<ConfigurationProfileDocument | null> {
    return this.findOne({ name });
  }

  async findDefault(): Promise<ConfigurationProfileDocument | null> {
    return this.findOne({ isDefault: true });
  }

  async updateById(
    profileId: string,
    patch: Partial<
      Pick<
        ConfigurationProfileDocument,
        | 'name'
        | 'exhibitionRules'
        | 'connectivityMode'
        | 'commercialTierMultiplier'
        | 'isDefault'
      >
    >
  ): Promise<ConfigurationProfileDocument | null> {
    return this.updateOne({ profileId }, { $set: patch });
  }

  async deleteById(profileId: string): Promise<boolean> {
    return this.deleteOne({ profileId });
  }
}
