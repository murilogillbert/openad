import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminSession, AdminSessionDocument } from './schemas/admin-session.schema';

export class AdminSessionsRepository {
  constructor(
    @InjectModel(AdminSession.name)
    private readonly model: Model<AdminSessionDocument>
  ) {}

  async upsertForUserDevice(params: {
    userId: string;
    deviceId: string;
    label: string;
    now: Date;
    newSessionId: string;
  }): Promise<AdminSessionDocument> {
    return this.model
      .findOneAndUpdate(
        { userId: params.userId, deviceId: params.deviceId },
        {
          $setOnInsert: {
            sessionId: params.newSessionId,
            userId: params.userId,
            deviceId: params.deviceId,
          },
          $set: {
            label: params.label,
            lastActiveAt: params.now,
            revokedAt: null,
          },
        },
        { upsert: true, returnDocument: 'after' }
      )
      .exec()
      .then((d) => {
        // Mongoose typing can still allow null here; guard to keep runtime behavior safe.
        if (!d) throw new Error('Failed to upsert admin session');
        return d;
      });
  }

  create(params: {
    sessionId: string;
    userId: string;
    label: string;
    now: Date;
  }): Promise<AdminSessionDocument> {
    return this.model.create({
      sessionId: params.sessionId,
      userId: params.userId,
      deviceId: null,
      label: params.label,
      lastActiveAt: params.now,
      revokedAt: null,
    });
  }

  listForUser(userId: string): Promise<AdminSessionDocument[]> {
    return this.model.find({ userId }).sort({ lastActiveAt: -1 }).limit(100).exec();
  }

  findBySessionId(sessionId: string): Promise<AdminSessionDocument | null> {
    return this.model.findOne({ sessionId }).exec();
  }

  touch(sessionId: string, now: Date): Promise<void> {
    return this.model
      .updateOne({ sessionId }, { $set: { lastActiveAt: now } })
      .then(() => undefined);
  }

  revokeOthers(params: { userId: string; keepSessionId: string; now: Date }): Promise<number> {
    return this.model
      .updateMany(
        {
          userId: params.userId,
          sessionId: { $ne: params.keepSessionId },
          revokedAt: null,
        },
        { $set: { revokedAt: params.now } }
      )
      .then((r) => r.modifiedCount ?? 0);
  }
}

