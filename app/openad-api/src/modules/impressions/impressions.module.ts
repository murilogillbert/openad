import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { DevicesModule } from '../devices/devices.module';
import {
  ImpressionEventRecord,
  ImpressionEventSchema,
} from './impression-event.schema';
import { ImpressionEventsRepository } from './impression-events.repository';
import { ImpressionIngestionService } from './impression-ingestion.service';
import { ImpressionStreamConsumer } from './impression-stream.consumer';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ImpressionEventRecord.name, schema: ImpressionEventSchema },
    ]),
    forwardRef(() => CampaignsModule),
    forwardRef(() => DevicesModule),
  ],
  providers: [
    ImpressionEventsRepository,
    ImpressionIngestionService,
    ImpressionStreamConsumer,
  ],
  exports: [ImpressionEventsRepository, MongooseModule],
})
export class ImpressionsModule {}
