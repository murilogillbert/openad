import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { commandAckPayloadSchema } from '@openad/mqtt-contracts';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RemoteCommandsRepository } from './remote-commands.repository';
import { NotificationService } from './notification.service';

@Injectable()
export class CommandAckHandler implements OnModuleInit {
  constructor(
    private readonly logger: PinoLogger,
    private readonly mqtt: MqttService,
    private readonly commands: RemoteCommandsRepository,
    private readonly notifications: NotificationService
  ) {
    this.logger.setContext(CommandAckHandler.name);
  }

  onModuleInit(): void {
    this.mqtt.subscribe('openad/+/commands/ack', (topic, payload) => {
      void this.handleAck(topic, payload);
    });
    this.logger.info({}, 'Subscribed to openad/+/commands/ack');
  }

  private extractDeviceId(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length >= 4 && parts[0] === 'openad' && parts[2] === 'commands') {
      return parts[1] ?? null;
    }
    return null;
  }

  async handleAck(topic: string, payload: Buffer): Promise<void> {
    const deviceId = this.extractDeviceId(topic);
    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    const parsed = commandAckPayloadSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn({ deviceId, issues: parsed.error.issues }, 'ack schema failed');
      return;
    }
    const ack = parsed.data;

    const ok =
      ack.status === 'success' &&
      (ack.resultCode == null || ack.resultCode === 'OK');
    const status = ok ? 'Acknowledged' : 'Acknowledged_Failure';

    await this.commands.updateOne(
      { commandId: ack.commandId },
      {
        $set: {
          status,
          acknowledgedAt: new Date(ack.completedAt),
          deviceResponse: ack.details,
        },
      }
    );

    await this.notifications.broadcastDashboard({
      type: 'command_ack',
      deviceId,
      commandId: ack.commandId,
      status: ack.status,
    });

    this.logger.info(
      { commandId: ack.commandId, deviceId, status: ack.status, event: 'command.ack' },
      'command acknowledged'
    );
  }
}
