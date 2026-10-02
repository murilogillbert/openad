import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UploadSession, UploadSessionDocument } from '../schemas/upload-session.schema';

@Injectable()
export class UploadSessionCleanupJob {
  constructor(
    @InjectModel(UploadSession.name)
    private readonly uploadSessionModel: Model<UploadSessionDocument>
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleSessions(): Promise<void> {
    await this.uploadSessionModel
      .updateMany(
        { status: 'initiated', expiresAt: { $lt: new Date() } },
        { $set: { status: 'expired' } }
      )
      .exec();
  }
}
