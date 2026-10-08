import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { SchedulerLockService } from '../../../infrastructure/redis/scheduler-lock.service';
import { DoohRulesService } from '../dooh-rules.service';
import { MediaAsset, MediaAssetDocument } from '../schemas/media-asset.schema';

/**
 * FR-010: when the active ruleset version changes, mark affected rows for re-validation.
 */
@Injectable()
export class DoohMediaRevalidationJob {
  constructor(
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
    private readonly doohRules: DoohRulesService,
    private readonly logger: PinoLogger,
    private readonly lock: SchedulerLockService
  ) {
    this.logger.setContext(DoohMediaRevalidationJob.name);
  }

  /**
   * Marca o acervo para revalidacao, em **uma** instancia por vez.
   *
   * O updateMany e idempotente, mas ele zera alidationStatus e probeStatus de todo
   * ativo afetado — e a segunda replica os zeraria **depois** de a primeira ja ter comecado a
   * reprocessar, podendo recolocar em pending algo que acabou de ser validado.
   *
   * Lock de 10 min para um cron diario.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async flagStaleRuleVersions(): Promise<void> {
    await this.lock.comLock('openad:cron:dooh-revalidation', 10 * 60_000, () => this.marcar());
  }

  private async marcar(): Promise<void> {
    const current = this.doohRules.getRulesetVersion();
    const res = await this.mediaModel
      .updateMany(
        {
          isActive: true,
          vfsSource: 'vfs_presign',
          $or: [
            { doohRulesetVersion: { $exists: false } },
            { doohRulesetVersion: { $ne: current } },
          ],
        },
        {
          $set: {
            validationStatus: 'pending',
            probeStatus: 'pending',
          },
        }
      )
      .exec();
    if (res.modifiedCount > 0) {
      void this.logger.info(
        { modifiedCount: res.modifiedCount, current },
        'dooh revalidation flagged assets'
      );
    }
  }
}
