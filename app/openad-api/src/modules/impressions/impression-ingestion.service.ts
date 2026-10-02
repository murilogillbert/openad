import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { impressionPayloadSchema } from '@openad/mqtt-contracts';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

export const IMPRESSIONS_STREAM = 'stream:impressions';

@Injectable()
export class ImpressionIngestionService implements OnModuleInit {
  constructor(
    private readonly logger: PinoLogger,
    private readonly mqtt: MqttService,
    private readonly redis: RedisService
  ) {
    this.logger.setContext(ImpressionIngestionService.name);
  }

  onModuleInit(): void {
    this.mqtt.subscribe(
      'openad/+/impressions',
      (topic, payload) => {
        void this.onMessage(topic, payload);
      },
      2
    );
    this.logger.info({}, 'Subscribed to openad/+/impressions (QoS 2)');
  }

  private extractDeviceId(topic: string): string | null {
    const parts = topic.split('/');
    if (
      parts.length >= 4 &&
      parts[0] === 'openad' &&
      parts[2] === 'impressions'
    ) {
      return parts[1] ?? null;
    }
    return null;
  }

  /**
   * MQTT callback — validates, then appends to Redis stream for durable processing.
   */
  private async onMessage(topic: string, payload: Buffer): Promise<void> {
    const deviceId = this.extractDeviceId(topic);
    if (!deviceId) return;

    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn({ deviceId, event: 'impression.parse_error' }, 'invalid JSON');
      return;
    }

    const parsed = impressionPayloadSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(
        { deviceId, issues: parsed.error.issues, event: 'impression.schema_failed' },
        'impression schema validation failed'
      );
      return;
    }

    const body = JSON.stringify({
      deviceId,
      impression: parsed.data,
    });

    await this.redis.xadd(IMPRESSIONS_STREAM, '*', 'payload', body);

    this.logger.info(
      {
        deviceId,
        eventId: parsed.data.eventId,
        campaignId: parsed.data.campaignId,
        event: 'impression.streamed',
      },
      'impression appended to redis stream'
    );
  }
}
