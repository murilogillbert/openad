import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import {
  RemoteCommandRecord,
  RemoteCommandDocument,
} from './remote-command.schema';

@Injectable()
export class RemoteCommandsRepository extends AbstractRepository<RemoteCommandDocument> {
  constructor(
    @InjectModel(RemoteCommandRecord.name)
    model: Model<RemoteCommandDocument>
  ) {
    super(model);
  }

  async findByDeviceId(deviceId: string): Promise<RemoteCommandDocument[]> {
    return this.model
      .find({ deviceId })
      .sort({ issuedAt: -1 })
      .limit(100)
      .exec();
  }

  /** Marks non-terminal commands past `expiresAt` as `Expired`. */
  async markExpired(now: Date): Promise<number> {
    const r = await this.model
      .updateMany(
        {
          expiresAt: { $lt: now },
          status: {
            $in: [
              'Pending',
              'queued',
              'Delivered',
              'dispatched',
            ],
          },
        },
        { $set: { status: 'Expired' } }
      )
      .exec();
    return r.modifiedCount ?? 0;
  }

  /** Commands with screenshot objects past retention (`screenshotStoredAt` or legacy `updatedAt`). */
  async findStaleScreenshotRefs(
    cutoff: Date,
    limit: number
  ): Promise<Array<{ commandId: string; screenshotStorageUrl: string }>> {
    const rows = await this.model
      .find({
        screenshotStorageUrl: { $regex: /^r2:screenshots\// },
        $or: [
          { screenshotStoredAt: { $lt: cutoff } },
          {
            screenshotStoredAt: null,
            updatedAt: { $lt: cutoff },
          },
        ],
      })
      .limit(limit)
      .select('commandId screenshotStorageUrl')
      .lean()
      .exec();
    return rows
      .filter((r) => r.screenshotStorageUrl != null)
      .map((r) => ({
        commandId: r.commandId,
        screenshotStorageUrl: r.screenshotStorageUrl as string,
      }));
  }

  async clearScreenshotStorage(commandId: string): Promise<void> {
    await this.model
      .updateOne(
        { commandId },
        { $set: { screenshotStorageUrl: null, screenshotStoredAt: null } }
      )
      .exec();
  }
}
