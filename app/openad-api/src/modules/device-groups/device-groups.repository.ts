import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { DevicesRepository } from '../devices/devices.repository';
import { DeviceGroup, DeviceGroupDocument } from './device-group.schema';

export interface GroupPagination {
  page?: number;
  limit?: number;
}

@Injectable()
export class DeviceGroupsRepository extends AbstractRepository<DeviceGroupDocument> {
  constructor(
    @InjectModel(DeviceGroup.name) model: Model<DeviceGroupDocument>,
    private readonly devices: DevicesRepository
  ) {
    super(model);
  }

  async findAll(
    pagination?: GroupPagination
  ): Promise<{ data: DeviceGroupDocument[]; total: number }> {
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

  async findById(groupId: string): Promise<DeviceGroupDocument | null> {
    return this.findOne({ groupId });
  }

  async findByName(name: string): Promise<DeviceGroupDocument | null> {
    return this.findOne({ name });
  }

  async findByProfileId(profileId: string): Promise<DeviceGroupDocument[]> {
    return this.findMany({ profileId });
  }

  async updateById(
    groupId: string,
    patch: Partial<
      Pick<
        DeviceGroupDocument,
        'name' | 'profileId' | 'syncWindowRules' | 'configRevision'
      >
    >
  ): Promise<DeviceGroupDocument | null> {
    return this.updateOne({ groupId }, { $set: patch });
  }

  async deleteById(groupId: string): Promise<boolean> {
    return this.deleteOne({ groupId });
  }

  async getMemberCount(groupId: string): Promise<number> {
    return this.devices.countByGroupId(groupId);
  }

  async reassignProfileOnGroups(
    deletedProfileId: string,
    newProfileId: string
  ): Promise<void> {
    await this.model
      .updateMany(
        { profileId: deletedProfileId },
        { $set: { profileId: newProfileId } }
      )
      .exec();
  }
}
