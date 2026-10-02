import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage } from 'mongoose';
import {
  ImpressionEventRecord,
  ImpressionEventDocument,
} from './impression-event.schema';

@Injectable()
export class ImpressionEventsRepository {
  constructor(
    @InjectModel(ImpressionEventRecord.name)
    private readonly model: Model<ImpressionEventDocument>
  ) {}

  async insert(
    doc: Omit<ImpressionEventRecord, never>
  ): Promise<ImpressionEventDocument> {
    const created = new this.model(doc);
    return created.save();
  }

  async findByEventId(
    eventId: string
  ): Promise<ImpressionEventDocument | null> {
    return this.model.findOne({ eventId }).exec();
  }

  async countByCampaignId(campaignId: string): Promise<number> {
    return this.model.countDocuments({ campaignId }).exec();
  }

  async findByCampaignPlayedBetween(
    campaignId: string,
    from: Date,
    to: Date
  ): Promise<ImpressionEventDocument[]> {
    return this.model
      .find({
        campaignId,
        playedAt: { $gte: from, $lte: to },
      })
      .sort({ playedAt: 1 })
      .exec();
  }

  async findByCampaignId(
    campaignId: string
  ): Promise<ImpressionEventDocument[]> {
    return this.model.find({ campaignId }).sort({ playedAt: 1 }).exec();
  }

  async aggregate(pipeline: PipelineStage[]): Promise<unknown[]> {
    return this.model.aggregate(pipeline).exec();
  }

  async countPlayedSince(since: Date): Promise<number> {
    return this.model.countDocuments({ playedAt: { $gte: since } }).exec();
  }

  async countPlayedBetween(from: Date, to: Date): Promise<number> {
    return this.model
      .countDocuments({ playedAt: { $gte: from, $lt: to } })
      .exec();
  }

  /** Last 24h plays grouped by hour bucket for sparkline. */
  async hourlyPlayCountsForDevice(
    deviceId: string,
    since: Date
  ): Promise<{ hour: string; count: number }[]> {
    const rows = await this.model
      .aggregate<{ _id: string; count: number }>([
        {
          $match: {
            deviceId,
            playedAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%dT%H:00:00.000Z',
                date: '$playedAt',
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    return rows.map((r) => ({ hour: r._id, count: r.count }));
  }
}
