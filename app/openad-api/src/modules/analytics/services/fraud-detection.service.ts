import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { Model } from 'mongoose';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { TELEMETRY_STREAM_KEY } from '../constants/telemetry-stream.constants';
import type { ReconciliationStatus } from '../schemas/play-record.schema';
import { PlayRecord } from '../schemas/play-record.schema';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';

/**
 * Post-reconciliation fraud / integrity pass (US4). Uses the same Redis telemetry
 * stream as {@link TelemetryIngestorService} (fleet-monitor) for heartbeat density.
 */
@Injectable()
export class FraudDetectionService {
  constructor(
    @InjectModel(PlayRecord.name)
    private readonly playRecords: Model<PlayRecord>,
    private readonly redis: RedisService,
    private readonly cfg: PlatformConfigRuntimeService
  ) {}

  /**
   * Pure helpers for unit tests — implied km/h from WGS84 start/end over duration.
   */
  static impliedSpeedKmh(params: {
    latStart: number;
    lngStart: number;
    latEnd: number;
    lngEnd: number;
    durationSec: number;
  }): number | null {
    if (params.durationSec < 0.5) {
      return null;
    }
    const km =
      distance(
        point([params.lngStart, params.latStart]),
        point([params.lngEnd, params.latEnd]),
        { units: 'kilometers' }
      ) ?? 0;
    return (km / params.durationSec) * 3600;
  }

  static heartbeatRatioMetric(params: {
    telemetryCount: number;
    durationSec: number;
    expectedIntervalSec: number;
  }): number {
    const expected = Math.max(1, params.durationSec / params.expectedIntervalSec);
    return params.telemetryCount / expected;
  }

  async applyFraudRules(deviceId: string, uniqueEventId: string): Promise<void> {
    const doc = await this.playRecords
      .findOne({ deviceId, uniqueEventId })
      .lean()
      .exec();
    if (!doc) {
      return;
    }

    const start = new Date(doc.timestampStart).getTime();
    const end = new Date(doc.timestampEnd).getTime();
    const durationSec = Math.max(0, (end - start) / 1000);

    const implied = FraudDetectionService.impliedSpeedKmh({
      latStart: doc.latStart,
      lngStart: doc.lngStart,
      latEnd: doc.latEnd,
      lngEnd: doc.lngEnd,
      durationSec,
    });

    const c = this.cfg.get().analytics;
    const maxKmh = c.maxVelocityKmh;
    const blackoutLux = c.fraudBlackoutMaxLux;
    const heartbeatInterval = c.fraudHeartbeatIntervalSec;
    const minHbRatio = c.fraudHeartbeatMinRatio;

    const windowStart = new Date(start - 120_000);
    const windowEnd = new Date(end + 120_000);
    const telemetryCount = await this.countTelemetryForDevice(
      deviceId,
      windowStart,
      windowEnd
    );
    const hbRatio = FraudDetectionService.heartbeatRatioMetric({
      telemetryCount,
      durationSec: Math.max(durationSec, 1),
      expectedIntervalSec: heartbeatInterval,
    });

    let nextStatus: ReconciliationStatus | null = null;
    let billable = doc.billable;

    const wasBillable = doc.reconciliationStatus === 'billable' && doc.billable;

    if (
      doc.displayLux != null &&
      doc.displayLux < blackoutLux &&
      wasBillable
    ) {
      nextStatus = 'blackout';
      billable = false;
    } else if (
      implied != null &&
      implied > maxKmh &&
      wasBillable
    ) {
      nextStatus = 'fraud_velocity';
      billable = false;
    } else if (hbRatio < minHbRatio && wasBillable) {
      nextStatus = 'fraud_heartbeat';
      billable = false;
    }

    const update: Record<string, unknown> = {
      impliedSpeedKmh: implied,
      heartbeatRatio: hbRatio,
    };
    if (nextStatus != null) {
      update['reconciliationStatus'] = nextStatus;
      update['billable'] = billable;
    }

    await this.playRecords.updateOne({ deviceId, uniqueEventId }, { $set: update });
  }

  private async countTelemetryForDevice(
    deviceId: string,
    from: Date,
    to: Date
  ): Promise<number> {
    const start = `${from.getTime()}-0`;
    const end = `${to.getTime()}-9999999999999`;
    const client = this.redis.getClient();
    let total = 0;
    try {
      const batch = await client.xrange(
        TELEMETRY_STREAM_KEY,
        start,
        end,
        'COUNT',
        8000
      );
      if (!Array.isArray(batch)) {
        return 0;
      }
      for (const row of batch) {
        const fields = row[1] as string[];
        if (!fields?.length) continue;
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === 'deviceId' && fields[i + 1] === deviceId) {
            total++;
            break;
          }
        }
      }
    } catch {
      return 0;
    }
    return total;
  }
}
