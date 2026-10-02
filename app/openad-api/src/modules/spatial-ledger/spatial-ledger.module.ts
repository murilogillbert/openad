import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MqttModule } from '../../infrastructure/mqtt/mqtt.module';
import {
  LostOpportunityEventRecord,
  LostOpportunityEventSchema,
} from './schemas/lost-opportunity-event.schema';
import {
  SpatialReceiptRecord,
  SpatialReceiptSchema,
} from './schemas/spatial-receipt.schema';
import {
  ZoneResidencyIntervalRecord,
  ZoneResidencyIntervalSchema,
} from './schemas/zone-residency-interval.schema';
import { SpatialLedgerController } from './spatial-ledger.controller';
import { SpatialLedgerIngestService } from './spatial-ledger-ingest.service';
import { SpatialLedgerMqttService } from './spatial-ledger-mqtt.service';
import { SpatialLedgerQueryService } from './spatial-ledger-query.service';

@Module({
  imports: [
    MqttModule,
    MongooseModule.forFeature([
      { name: SpatialReceiptRecord.name, schema: SpatialReceiptSchema },
      {
        name: ZoneResidencyIntervalRecord.name,
        schema: ZoneResidencyIntervalSchema,
      },
      {
        name: LostOpportunityEventRecord.name,
        schema: LostOpportunityEventSchema,
      },
    ]),
  ],
  controllers: [SpatialLedgerController],
  providers: [
    SpatialLedgerIngestService,
    SpatialLedgerQueryService,
    SpatialLedgerMqttService,
  ],
  exports: [SpatialLedgerIngestService, SpatialLedgerQueryService, MongooseModule],
})
export class SpatialLedgerModule {}
