import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { gunzipSync } from 'zlib';
import type { Request } from 'express';
import {
  playBatchEnvelopeSchema,
  playRecordSchema,
  type PlayRecordPayload,
} from '@openad/api-contracts';
import { ANALYTICS_RECONCILIATION_QUEUE } from '../constants/analytics-queue.constants';
import type { PlayBatchJobData } from '../processors/analytics-reconciliation.processor';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';

export interface PlayRecordRejectResult {
  index: number;
  uniqueEventId: string | null;
  message: string;
}

export interface PlayBatchIngestResult {
  batchId: string;
  acceptedCount: number;
  enqueued: boolean;
  rejected: PlayRecordRejectResult[];
}

type RequestWithRaw = Request & { rawBody?: Buffer };

@Injectable()
export class PlaybackBatchIngestService {
  constructor(
    @InjectQueue(ANALYTICS_RECONCILIATION_QUEUE)
    private readonly queue: Queue<PlayBatchJobData>,
    private readonly cfg: PlatformConfigRuntimeService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(PlaybackBatchIngestService.name);
  }

  async ingestFromDeviceRequest(
    deviceId: string,
    req: Request
  ): Promise<PlayBatchIngestResult> {
    if (!this.cfg.get().analytics.enabled) {
      throw new ServiceUnavailableException({
        error: {
          code: 'ANALYTICS_DISABLED',
          message:
            'Fleet analytics is disabled in platform configuration. Enable it under Settings → Platform.',
        },
      });
    }
    const maxBytes = this.cfg.get().analytics.playBatchMaxBytes;
    const encoding = req.headers['content-encoding'];
    const r = req as RequestWithRaw;

    let envelopeJson: unknown;
    if (encoding === 'gzip') {
      const raw = r.rawBody;
      if (!raw?.length) {
        throw new BadRequestException({
          error: {
            code: 'MISSING_RAW_BODY',
            message:
              'gzip ingest requires rawBody (enable rawBody in Nest bootstrap)',
          },
        });
      }
      if (raw.length > maxBytes) {
        throw new BadRequestException({
          error: { code: 'BODY_TOO_LARGE', message: 'Batch exceeds size limit' },
        });
      }
      const decoded = gunzipSync(raw);
      try {
        envelopeJson = JSON.parse(decoded.toString('utf8'));
      } catch {
        throw new BadRequestException({
          error: { code: 'INVALID_JSON', message: 'Gzip payload is not JSON' },
        });
      }
    } else {
      envelopeJson = req.body;
    }

    const envelopeParse = playBatchEnvelopeSchema.safeParse(envelopeJson);
    if (!envelopeParse.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_BATCH',
          message: 'Batch envelope validation failed',
          details: envelopeParse.error.flatten(),
        },
      });
    }
    const envelope = envelopeParse.data;
    if (envelope.deviceId !== deviceId) {
      throw new BadRequestException({
        error: {
          code: 'DEVICE_MISMATCH',
          message: 'batch.deviceId must match route deviceId',
        },
      });
    }

    return this.validatePlaysAndEnqueue(envelope);
  }

  private async validatePlaysAndEnqueue(envelope: {
    batchId: string;
    deviceId: string;
    plays: unknown[];
  }): Promise<PlayBatchIngestResult> {
    const accepted: PlayRecordPayload[] = [];
    const rejected: PlayRecordRejectResult[] = [];

    envelope.plays.forEach((play, index) => {
      const r = playRecordSchema.safeParse(play);
      if (!r.success) {
        rejected.push({
          index,
          uniqueEventId:
            typeof play === 'object' &&
            play !== null &&
            'uniqueEventId' in play &&
            typeof (play as { uniqueEventId: unknown }).uniqueEventId ===
              'string'
              ? ((play as { uniqueEventId: string }).uniqueEventId as string)
              : null,
          message: r.error.message,
        });
        return;
      }
      if (r.data.deviceId !== envelope.deviceId) {
        rejected.push({
          index,
          uniqueEventId: r.data.uniqueEventId,
          message: 'play.deviceId must match batch.deviceId',
        });
        return;
      }
      accepted.push(r.data);
    });

    let enqueued = false;
    if (accepted.length > 0) {
      await this.queue.add(
        'play-batch',
        {
          deviceId: envelope.deviceId,
          batchId: envelope.batchId,
          plays: accepted,
        } satisfies PlayBatchJobData,
        {
          removeOnComplete: true,
          removeOnFail: false,
          /**
           * `jobId` derivado do lote: reenvio em rajada não vira um segundo job.
           *
           * O caso real é o tablet reenviar o lote depois de um timeout — normal numa frota
           * com rede ruim. Sem `jobId`, cada reenvio enfileirava um job independente.
           *
           * **Isto não substitui a trava no banco**, e é importante não confundir as duas. O
           * BullMQ descarta o `add` duplicado só enquanto o job existe, e aqui
           * `removeOnComplete: true` libera o id assim que o job termina — um reenvio depois
           * disso volta a ser enfileirado. A garantia de cobrar uma vez só está em
           * `billingAppliedAt`, reivindicado por `findOneAndUpdate` no processor. Este
           * `jobId` mata o caso frequente e barato; a trava mata o caso que custa dinheiro.
           *
           * O `deviceId` entra no id porque `batchId` é escolhido pelo dispositivo: sem o
           * prefixo, dois aparelhos que sorteassem o mesmo valor se anulariam.
           */
          jobId: `play-batch:${envelope.deviceId}:${envelope.batchId}`,
        }
      );
      enqueued = true;
    }

    const result: PlayBatchIngestResult = {
      batchId: envelope.batchId,
      acceptedCount: accepted.length,
      enqueued,
      rejected,
    };
    this.logger.info(
      {
        event: 'analytics.play_batch.ingested',
        deviceId: envelope.deviceId,
        batchId: envelope.batchId,
        acceptedCount: result.acceptedCount,
        rejectedCount: rejected.length,
        enqueued: result.enqueued,
      },
      'play batch ingested'
    );
    return result;
  }
}
