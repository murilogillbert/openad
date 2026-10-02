import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  priorityAckSchema,
  priorityCommandSchema,
  type PriorityCommandPayload,
} from '@openad/mqtt-contracts';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';

/**
 * Publishes priority ad commands over MQTT and ingests device acknowledgments.
 * TLS/mTLS for the broker connection is configured in {@link MqttService} (shared client).
 */
@Injectable()
export class PriorityCommandsGateway implements OnModuleInit {
  private readonly logger = new Logger(PriorityCommandsGateway.name);

  constructor(private readonly mqtt: MqttService) {}

  onModuleInit(): void {
    this.mqtt.subscribe(
      'devices/+/priority/ack',
      (topic, payload) => {
        try {
          const raw = payload.toString('utf8');
          const data = JSON.parse(raw) as unknown;
          const parsed = priorityAckSchema.safeParse(data);
          if (parsed.success) {
            this.logger.log(
              { event: 'priority.ack', topic, ...parsed.data },
              'priority ack'
            );
          }
        } catch {
          this.logger.warn({ topic }, 'invalid priority ack payload');
        }
      },
      1
    );
  }

  /**
   * Publishes a validated priority command to either a single device or broadcast.
   */
  async sendPriorityCommand(cmd: PriorityCommandPayload): Promise<void> {
    const parsed = priorityCommandSchema.safeParse(cmd);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid priority command',
        issues: parsed.error.flatten(),
      });
    }
    const p = parsed.data;
    const body = JSON.stringify(p);

    if (p.broadcast) {
      await this.mqtt.publish('openad/priority/broadcast', body, 1, false);
      this.logger.log({ event: 'priority.publish', mode: 'broadcast' });
      return;
    }

    if (p.targetDeviceId) {
      const topic = `devices/${p.targetDeviceId}/priority`;
      await this.mqtt.publish(topic, body, 1, false);
      this.logger.log({
        event: 'priority.publish',
        mode: 'device',
        deviceId: p.targetDeviceId,
      });
      return;
    }

    throw new BadRequestException(
      'Set broadcast: true or provide targetDeviceId'
    );
  }
}
