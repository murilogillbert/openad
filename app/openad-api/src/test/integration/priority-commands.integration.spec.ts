import { Test } from '@nestjs/testing';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { PriorityCommandsGateway } from '../../modules/priority-commands/priority-commands.gateway';
import { priorityCommandSchema } from '@openad/mqtt-contracts';

describe('PriorityCommandsGateway (integration)', () => {
  it('publishes validated commands through MqttService', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const subscribe = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PriorityCommandsGateway,
        {
          provide: MqttService,
          useValue: {
            publish,
            subscribe,
          },
        },
      ],
    }).compile();

    await moduleRef.init();
    const gateway = moduleRef.get(PriorityCommandsGateway);

    const cmd = priorityCommandSchema.parse({
      commandId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      mediaId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      priority: 'emergency',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      targetDeviceId: 'b2c3d4e5-f6a7-4890-b123-456789abcdef',
    });

    await gateway.sendPriorityCommand(cmd);

    expect(publish).toHaveBeenCalledWith(
      `devices/${cmd.targetDeviceId}/priority`,
      expect.stringContaining(cmd.commandId),
      1,
      false
    );

    await moduleRef.close();
  });
});
