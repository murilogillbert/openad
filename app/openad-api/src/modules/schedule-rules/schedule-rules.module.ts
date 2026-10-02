import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleRule, ScheduleRuleSchema } from './schedule-rule.schema';
import { ScheduleRulesRepository } from './schedule-rules.repository';
import { GeoScheduleEvaluatorService } from './geo-schedule-evaluator.service';
import { ScheduleRuleService } from './schedule-rule.service';
import { SchedulePushService } from './schedule-push.service';
import { AssetUrlRotationWorker } from './asset-url-rotation.worker';
import { AssetUrlRotationScheduler } from './asset-url-rotation.scheduler';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { GeoZonesModule } from '../geo-zones/geo-zones.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScheduleRule.name, schema: ScheduleRuleSchema },
    ]),
    forwardRef(() => CampaignsModule),
    GeoZonesModule,
    forwardRef(() => VehiclesModule),
    forwardRef(() => DevicesModule),
  ],
  providers: [
    ScheduleRulesRepository,
    GeoScheduleEvaluatorService,
    ScheduleRuleService,
    SchedulePushService,
    AssetUrlRotationWorker,
    AssetUrlRotationScheduler,
  ],
  exports: [
    ScheduleRulesRepository,
    ScheduleRuleService,
    SchedulePushService,
    GeoScheduleEvaluatorService,
  ],
})
export class ScheduleRulesModule {}
