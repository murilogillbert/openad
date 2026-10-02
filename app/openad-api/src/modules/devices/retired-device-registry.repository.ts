import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import {
  RetiredDeviceRegistry,
  RetiredDeviceRegistryDocument,
} from './retired-device-registry.schema';

@Injectable()
export class RetiredDeviceRegistryRepository extends AbstractRepository<RetiredDeviceRegistryDocument> {
  constructor(
    @InjectModel(RetiredDeviceRegistry.name)
    model: Model<RetiredDeviceRegistryDocument>
  ) {
    super(model);
  }

  async insert(
    entry: Pick<
      RetiredDeviceRegistryDocument,
      'deviceId' | 'retiredAt' | 'retiredByAdminId'
    >
  ): Promise<RetiredDeviceRegistryDocument> {
    return this.create(entry);
  }

  async exists(deviceId: string): Promise<boolean> {
    const doc = await this.findOne({ deviceId });
    return doc !== null;
  }
}
