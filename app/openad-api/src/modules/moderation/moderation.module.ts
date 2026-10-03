import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { MediaIngestionModule } from '../media-ingestion/media-ingestion.module';
import { ScheduleRulesModule } from '../schedule-rules/schedule-rules.module';
import {
  MediaAsset,
  MediaAssetSchema,
} from '../media-ingestion/schemas/media-asset.schema';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
    ]),
    AuthModule,
    CampaignsModule,
    MediaIngestionModule,
    // `ScheduleRulesModule` importa `CampaignsModule`, que este modulo tambem importa; o
    // `forwardRef` evita o ciclo na resolucao.
    forwardRef(() => ScheduleRulesModule),
  ],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
