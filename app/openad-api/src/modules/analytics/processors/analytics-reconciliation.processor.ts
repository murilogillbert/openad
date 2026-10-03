import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Job } from 'bullmq';
import { Model } from 'mongoose';
import type { PlayRecordPayload } from '@openad/api-contracts';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';
import { ANALYTICS_RECONCILIATION_QUEUE } from '../constants/analytics-queue.constants';
import { PlayRecord } from '../schemas/play-record.schema';
import { FraudDetectionService } from '../services/fraud-detection.service';
import { PacingSignalService } from '../services/pacing-signal.service';
import { ReconciliationService } from '../services/reconciliation.service';

export interface PlayBatchJobData {
  deviceId: string;
  batchId: string;
  plays: PlayRecordPayload[];
}

@Processor(ANALYTICS_RECONCILIATION_QUEUE)
export class AnalyticsReconciliationProcessor extends WorkerHost {
  private readonly log = new Logger(AnalyticsReconciliationProcessor.name);

  constructor(
    @InjectModel(PlayRecord.name)
    private readonly playRecords: Model<PlayRecord>,
    private readonly reconciliation: ReconciliationService,
    private readonly fraud: FraudDetectionService,
    private readonly pacing: PacingSignalService,
    private readonly campaigns: CampaignsRepository,
    private readonly platform: PlatformConfigRuntimeService
  ) {
    super();
  }

  async process(job: Job<PlayBatchJobData>): Promise<void> {
    if (!this.platform.get().analytics.enabled) {
      this.log.warn('analytics disabled; skipping reconciliation job');
      return;
    }
    const { deviceId, batchId, plays } = job.data;
    const ingestedAt = new Date();
    for (const p of plays) {
      try {
        await this.playRecords.updateOne(
          { deviceId, uniqueEventId: p.uniqueEventId },
          {
            $setOnInsert: {
              uniqueEventId: p.uniqueEventId,
              deviceId: p.deviceId,
              vehicleId: p.vehicleId,
              campaignId: p.campaignId,
              mediaId: p.mediaId ?? null,
              timestampStart: new Date(p.timestampStart),
              timestampEnd: new Date(p.timestampEnd),
              latStart: p.latStart,
              lngStart: p.lngStart,
              latEnd: p.latEnd,
              lngEnd: p.lngEnd,
              triggerReason: p.triggerReason,
              batteryLevel: p.batteryLevel,
              networkType: p.networkType,
              gpsAccuracyM: p.gpsAccuracyM,
              displayLux: p.displayLux ?? null,
              ingestedAt,
              batchId,
              reconciliationStatus: 'pending',
              billable: false,
              impliedSpeedKmh: null,
              heartbeatRatio: null,
            },
          },
          { upsert: true }
        );

        const pre = await this.playRecords
          .findOne({ deviceId, uniqueEventId: p.uniqueEventId })
          .lean()
          .exec();

        await this.reconciliation.reconcileOne(deviceId, p.uniqueEventId);
        await this.fraud.applyFraudRules(deviceId, p.uniqueEventId);

        const updated = await this.playRecords
          .findOne({ deviceId, uniqueEventId: p.uniqueEventId })
          .lean()
          .exec();

        if (
          pre?.reconciliationStatus === 'pending' &&
          updated?.billable &&
          updated.reconciliationStatus === 'billable'
        ) {
          const campaign = await this.campaigns.findByCampaignId(
            updated.campaignId
          );
          /**
           * A tarifa ja esta em centavos inteiros, entao nao ha conversao nem arredondamento
           * aqui. A versao anterior fazia `Math.max(1, Math.round(rate * 100))`: o `round`
           * escondia fracao de centavo e o piso em 1 fazia **qualquer** tarifa abaixo de um
           * centavo faturar um centavo — campanha configurada com tarifa zero cobrava.
           *
           * Tarifa zero agora custa zero, e e a resposta correta: ha inventario institucional
           * e filler, que toca sem faturar.
           */
          const costCents = campaign?.budget?.ratePerImpressionCents ?? 0;
          await this.pacing.recordBillablePlayCost({
            campaignId: updated.campaignId,
            costCents,
            at: new Date(updated.timestampEnd),
          });
        }

        const status = updated?.reconciliationStatus;
        const fraudSignal =
          status === 'blackout' ||
          status === 'fraud_velocity' ||
          status === 'fraud_heartbeat';
        this.log.log(
          JSON.stringify({
            event: 'analytics.play.reconciled',
            deviceId,
            uniqueEventId: p.uniqueEventId,
            status,
            billable: updated?.billable,
            impliedSpeedKmh: updated?.impliedSpeedKmh ?? null,
            heartbeatRatio: updated?.heartbeatRatio ?? null,
            fraudSignal,
          })
        );
      } catch (err: unknown) {
        this.log.warn(
          {
            event: 'analytics.play.insert_failed',
            deviceId,
            uniqueEventId: p.uniqueEventId,
            err,
          },
          'play insert failed'
        );
        throw err;
      }
    }
  }
}
