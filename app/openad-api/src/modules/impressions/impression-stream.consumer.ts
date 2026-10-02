import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import type { ImpressionPayload } from '@openad/mqtt-contracts';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { DevicesRepository } from '../devices/devices.repository';
import { ImpressionEventsRepository } from './impression-events.repository';
import {
  impressionLocationVerified,
  snapshotBillingValue,
} from './impression-mapping';
import { IMPRESSIONS_STREAM } from './impression-ingestion.service';

const GROUP = 'impression-workers';

@Injectable()
export class ImpressionStreamConsumer implements OnModuleInit {
  private readonly consumerName = `api-${process.pid}`;

  constructor(
    private readonly logger: PinoLogger,
    private readonly redis: RedisService,
    private readonly impressions: ImpressionEventsRepository,
    private readonly campaigns: CampaignsRepository,
    private readonly devices: DevicesRepository
  ) {
    this.logger.setContext(ImpressionStreamConsumer.name);
  }

  async onModuleInit(): Promise<void> {
    await this.redis.ensureConsumerGroup(IMPRESSIONS_STREAM, GROUP);
    this.logger.info(
      { stream: IMPRESSIONS_STREAM, group: GROUP },
      'impression stream consumer group ready'
    );
  }

  @Cron('*/2 * * * * *')
  async drainStream(): Promise<void> {
    let res: unknown;
    try {
      res = await this.redis.xreadgroupBatch(
        GROUP,
        this.consumerName,
        IMPRESSIONS_STREAM,
        { count: 50, blockMs: 500 }
      );
    } catch (e: unknown) {
      this.logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'xreadgroup failed'
      );
      return;
    }

    if (!res) return;

    const entries = parseXreadgroup(res);
    for (const { id, payload } of entries) {
      await this.processEntry(id, payload);
    }
  }

  private async processEntry(
    streamId: string,
    payloadJson: string
  ): Promise<void> {
    let envelope: { deviceId: string; impression: ImpressionPayload };
    try {
      envelope = JSON.parse(payloadJson) as {
        deviceId: string;
        impression: ImpressionPayload;
      };
    } catch {
      await this.ack(streamId);
      return;
    }

    const { deviceId, impression } = envelope;
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device?.boundVehicleId) {
      this.logger.debug(
        { deviceId, eventId: impression.eventId },
        'impression skipped: device unbound'
      );
      await this.ack(streamId);
      return;
    }

    const campaign = await this.campaigns.findByCampaignId(
      impression.campaignId
    );
    if (!campaign) {
      this.logger.warn(
        { campaignId: impression.campaignId, eventId: impression.eventId },
        'impression skipped: campaign not found'
      );
      await this.ack(streamId);
      return;
    }

    const already = await this.impressions.findByEventId(impression.eventId);
    if (already) {
      this.logger.debug(
        { eventId: impression.eventId, event: 'impression.dedup' },
        'impression already stored; acking stream entry'
      );
      await this.ack(streamId);
      return;
    }

    const billingValue = snapshotBillingValue(campaign.budget.ratePerImpression);
    const currency = campaign.budget.currency;
    const locationVerified = impressionLocationVerified(
      impression.location.gpsLocked
    );
    const lat = impression.location.lat;
    const lng = impression.location.lng;
    const coords: [number, number] =
      lat != null && lng != null ? [lng, lat] : [0, 0];

    const playedAt = new Date(impression.ts);
    const receivedAt = new Date();

    try {
      await this.impressions.insert({
        eventId: impression.eventId,
        campaignId: impression.campaignId,
        scheduleRuleId: impression.scheduleRuleId,
        assetId: impression.assetId,
        vehicleId: device.boundVehicleId,
        deviceId,
        playedAt,
        receivedAt,
        durationPlayedSeconds: impression.durationPlayedSeconds,
        location: { type: 'Point', coordinates: coords },
        accuracyMeters: impression.location.accuracyMeters,
        locationVerified,
        billingValue,
        currency,
        mqttDeliveryId: null,
      });

      this.logger.info(
        {
          eventId: impression.eventId,
          deviceId,
          campaignId: impression.campaignId,
          locationVerified,
          billingValue,
          event: 'impression.persisted',
        },
        'impression stored'
      );
    } catch (e: unknown) {
      if (isMongoDuplicateKeyError(e)) {
        this.logger.info(
          {
            eventId: impression.eventId,
            deviceId,
            campaignId: impression.campaignId,
            event: 'impression.dedup',
          },
          'duplicate impression ignored'
        );
      } else {
        this.logger.error(
          { err: e instanceof Error ? e.message : String(e), eventId: impression.eventId },
          'impression insert failed'
        );
        return;
      }
    }

    await this.ack(streamId);
  }

  private async ack(streamId: string): Promise<void> {
    await this.redis.xack(IMPRESSIONS_STREAM, GROUP, streamId);
  }
}

function isMongoDuplicateKeyError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  if (o.code === 11000 || o.code === 11001) return true;
  const msg = typeof o.message === 'string' ? o.message : '';
  if (msg.includes('E11000') || msg.toLowerCase().includes('duplicate key')) {
    return true;
  }
  const cause = o.cause;
  if (cause && typeof cause === 'object') {
    const c = cause as Record<string, unknown>;
    if (c.code === 11000 || c.code === 11001) return true;
  }
  return false;
}

function parseXreadgroup(res: unknown): { id: string; payload: string }[] {
  const out: { id: string; payload: string }[] = [];
  if (!Array.isArray(res) || res.length === 0) return out;
  const streamBlock = res[0] as unknown[];
  if (!Array.isArray(streamBlock) || streamBlock.length < 2) return out;
  const entries = streamBlock[1] as unknown[];
  if (!Array.isArray(entries)) return out;
  for (const row of entries) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const id = String(row[0]);
    const fields = row[1] as string[];
    if (!Array.isArray(fields)) continue;
    const payloadIdx = fields.indexOf('payload');
    if (payloadIdx >= 0 && fields[payloadIdx + 1]) {
      out.push({ id, payload: fields[payloadIdx + 1] });
    }
  }
  return out;
}
