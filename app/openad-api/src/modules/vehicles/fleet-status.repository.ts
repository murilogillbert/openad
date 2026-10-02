import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import {
  FleetStatusRecord,
  FleetStatusDocument,
} from './fleet-status.schema';

@Injectable()
export class FleetStatusRepository extends AbstractRepository<FleetStatusDocument> {
  constructor(
    @InjectModel(FleetStatusRecord.name) model: Model<FleetStatusDocument>
  ) {
    super(model);
  }

  async findByDeviceIds(deviceIds: string[]): Promise<FleetStatusDocument[]> {
    if (deviceIds.length === 0) return [];
    return this.model.find({ deviceId: { $in: deviceIds } }).exec();
  }

  async findAll(): Promise<FleetStatusDocument[]> {
    return this.model.find().sort({ reportedAt: -1 }).exec();
  }

  async upsertByDeviceId(
    deviceId: string,
    doc: Partial<FleetStatusRecord> & Pick<FleetStatusRecord, 'vehicleId'>
  ): Promise<FleetStatusDocument> {
    return this.model
      .findOneAndUpdate(
        { deviceId },
        { $set: { ...doc, deviceId } },
        { upsert: true, new: true }
      )
      .exec() as Promise<FleetStatusDocument>;
  }

  async markOffline(
    deviceId: string,
    alertFlags: string[]
  ): Promise<void> {
    await this.model
      .updateOne(
        { deviceId },
        {
          $set: {
            'connectivity.status': 'offline',
            alertFlags,
          },
        }
      )
      .exec();
  }
}
