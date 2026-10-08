import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SchedulerLockService } from '../../../infrastructure/redis/scheduler-lock.service';
import { UploadSession, UploadSessionDocument } from '../schemas/upload-session.schema';

@Injectable()
export class UploadSessionCleanupJob {
  constructor(
    @InjectModel(UploadSession.name)
    private readonly uploadSessionModel: Model<UploadSessionDocument>,
    private readonly lock: SchedulerLockService
  ) {}

  /**
   * Expira sessoes de upload abandonadas, em **uma** instancia por vez.
   *
   * O `updateMany` e idempotente, entao a duplicacao nao corrompe nada — o lock evita duas
   * varreduras da colecao por hora, por replica. Lock de 10 min para um cron de 1 h.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleSessions(): Promise<void> {
    await this.lock.comLock('openad:cron:upload-session-cleanup', 10 * 60_000, async () => {
      await this.uploadSessionModel
        .updateMany(
          { status: 'initiated', expiresAt: { $lt: new Date() } },
          { $set: { status: 'expired' } }
        )
        .exec();
    });
  }
}