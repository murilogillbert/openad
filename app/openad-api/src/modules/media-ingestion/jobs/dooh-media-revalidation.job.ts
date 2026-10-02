import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
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
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(DoohMediaRevalidationJob.name);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async flagStaleRuleVersions(): Promise<void> {
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
