import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PinoLogger } from 'nestjs-pino';
import { Model } from 'mongoose';
import { spatialLedgerBatchSchema } from '@openad/mqtt-contracts';
import {
  LostOpportunityEventRecord,
  type LostOpportunityEventDocument,
} from './schemas/lost-opportunity-event.schema';
import {
  SpatialReceiptRecord,
  type SpatialReceiptDocument,
} from './schemas/spatial-receipt.schema';
import {
  ZoneResidencyIntervalRecord,
  type ZoneResidencyIntervalDocument,
} from './schemas/zone-residency-interval.schema';

@Injectable()
export class SpatialLedgerIngestService {
  constructor(
    @InjectModel(SpatialReceiptRecord.name)
    private readonly receipts: Model<SpatialReceiptDocument>,
    @InjectModel(ZoneResidencyIntervalRecord.name)
    private readonly residencies: Model<ZoneResidencyIntervalDocument>,
    @InjectModel(LostOpportunityEventRecord.name)
    private readonly lost: Model<LostOpportunityEventDocument>,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(SpatialLedgerIngestService.name);
  }

  async ingestBatch(
    raw: unknown,
    mqttDeliveryId: string | null = null
  ): Promise<{ ok: boolean }> {
    const parsed = spatialLedgerBatchSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        { issues: parsed.error.issues, event: 'spatial_ledger.schema_failed' },
        'spatial ledger batch validation failed'
      );
      return { ok: false };
    }
    const batch = parsed.data;
    const receivedAt = new Date();

    try {
      switch (batch.kind) {
        case 'spatial.receipt':
          for (const e of batch.events) {
            await this.receipts.updateOne(
              { eventId: e.eventId },
              {
                $setOnInsert: {
                  eventId: e.eventId,
                  deviceId: e.deviceId,
                  mediaId: e.mediaId,
                  zoneId: e.zoneId,
                  startedAt: e.startedAt,
                  endedAt: e.endedAt,
                  coordinateStart: e.coordinateStart,
                  coordinateEnd: e.coordinateEnd,
                  accuracyMeters: e.accuracyMeters,
                  tier: e.tier,
                  receivedAt,
                  mqttDeliveryId,
                },
              },
              { upsert: true }
            );
          }
          break;
        case 'spatial.residency':
          for (const e of batch.events) {
            await this.residencies.updateOne(
              { intervalId: e.intervalId },
              {
                $setOnInsert: {
                  intervalId: e.intervalId,
                  deviceId: e.deviceId,
                  zoneId: e.zoneId,
                  enteredAt: e.enteredAt,
                  exitedAt: e.exitedAt,
                  playedAds: e.playedAds,
                  receivedAt,
                  mqttDeliveryId,
                },
              },
              { upsert: true }
            );
          }
          break;
        case 'spatial.lost_opportunity':
          for (const e of batch.events) {
            await this.lost.updateOne(
              { eventId: e.eventId },
              {
                $setOnInsert: {
                  eventId: e.eventId,
                  deviceId: e.deviceId,
                  suppressedMediaId: e.suppressedMediaId,
                  winningMediaId: e.winningMediaId,
                  reason: e.reason,
                  zoneId: e.zoneId,
                  ts: e.ts,
                  receivedAt,
                  mqttDeliveryId,
                },
              },
              { upsert: true }
            );
          }
          break;
      }
    } catch (err) {
      this.logger.error(
        { err, event: 'spatial_ledger.persist_failed' },
        'spatial ledger persist failed'
      );
      return { ok: false };
    }

    const count = batch.events.length;
    this.logger.info({ kind: batch.kind, count }, 'spatial ledger batch ingested');
    return { ok: true };
  }
}
