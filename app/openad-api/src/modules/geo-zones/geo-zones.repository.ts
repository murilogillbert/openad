import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { GeoZone, GeoZoneDocument } from './geo-zone.schema';

@Injectable()
export class GeoZonesRepository extends AbstractRepository<GeoZoneDocument> {
  constructor(
    @InjectModel(GeoZone.name) model: Model<GeoZoneDocument>
  ) {
    super(model);
  }

  async findByZoneId(zoneId: string): Promise<GeoZoneDocument | null> {
    return this.findOne({ zoneId });
  }

  async findByZoneIds(zoneIds: string[]): Promise<GeoZoneDocument[]> {
    if (zoneIds.length === 0) return [];
    return this.model.find({ zoneId: { $in: zoneIds } }).exec();
  }

  /** Zones that bind this media id (active geo-spatial rules). */
  async findZonesWithMediaBinding(mediaId: string): Promise<GeoZoneDocument[]> {
    return this.model
      .find({
        isActive: true,
        'bindings.mediaId': mediaId,
      })
      .exec();
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  async findActive(): Promise<GeoZoneDocument[]> {
    return this.model.find({ isActive: true }).exec();
  }

  async distinctCitiesActive(): Promise<string[]> {
    return this.model.distinct('city', { isActive: true }).exec();
  }
}
