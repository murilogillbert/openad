import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { Vehicle, VehicleDocument } from './vehicles.schema';

@Injectable()
export class VehiclesRepository extends AbstractRepository<VehicleDocument> {
  constructor(
    @InjectModel(Vehicle.name) model: Model<VehicleDocument>
  ) {
    super(model);
  }

  async findByVehicleId(vehicleId: string): Promise<VehicleDocument | null> {
    return this.findOne({ vehicleId });
  }

  async findByPairedDeviceId(deviceId: string): Promise<VehicleDocument | null> {
    return this.findOne({ pairedDeviceIds: deviceId });
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  /** Active vehicles with at least one paired tablet. */
  async findActiveWithPairedDevices(): Promise<VehicleDocument[]> {
    return this.model
      .find({
        status: 'active',
        pairedDeviceIds: { $exists: true, $not: { $size: 0 } },
      })
      .exec();
  }
}
