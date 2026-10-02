import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RemoteCommandsRepository } from './remote-commands.repository';
@Processor('command-dispatch')
export class CommandDispatchProcessor extends WorkerHost {
  constructor(
    private readonly logger: PinoLogger,
    private readonly mqtt: MqttService,
    private readonly commands: RemoteCommandsRepository
  ) {
    super();
    this.logger.setContext(CommandDispatchProcessor.name);
  }

  async process(job: Job<{ commandId: string }>): Promise<void> {
    const { commandId } = job.data;
    const cmd = await this.commands.findOne({ commandId });
    if (!cmd) {
      this.logger.warn({ commandId }, 'command not found for dispatch');
      return;
    }

    const topic = `openad/${cmd.deviceId}/commands`;
    const payload = {
      commandId: cmd.commandId,
      type: cmd.type,
      issuedAt: cmd.issuedAt.toISOString(),
      expiresAt: cmd.expiresAt.toISOString(),
      payload: cmd.payload,
    };

    await this.mqtt.publish(topic, payload, 1, false);

    const now = new Date();
    await this.commands.updateOne(
      { commandId },
      {
        $set: {
          status: 'Delivered',
          dispatchedAt: now,
          deliveredAt: now,
        },
      }
    );

    this.logger.info({ commandId, deviceId: cmd.deviceId, topic }, 'command dispatched via MQTT');
  }
}
