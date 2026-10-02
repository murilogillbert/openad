import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import {
  DeviceLifecycleEvent,
  DeviceLifecycleEventDocument,
} from './device-lifecycle-event.schema';

export interface LifecycleEventPagination {
  page?: number;
  limit?: number;
}

@Injectable()
export class DeviceLifecycleEventRepository extends AbstractRepository<DeviceLifecycleEventDocument> {
  constructor(
    @InjectModel(DeviceLifecycleEvent.name)
    model: Model<DeviceLifecycleEventDocument>
  ) {
    super(model);
  }

  async findByDevice(
    deviceId: string,
    pagination?: LifecycleEventPagination
  ): Promise<{
    data: DeviceLifecycleEventDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, pagination?.page ?? 1);
    const limit = Math.min(pagination?.limit ?? 50, 100);
    const filter = { deviceId };
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ occurredAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit };
  }

  async findAll(
    filter: Record<string, unknown> = {}
  ): Promise<DeviceLifecycleEventDocument[]> {
    return this.model.find(filter).sort({ occurredAt: -1 }).exec();
  }
}
