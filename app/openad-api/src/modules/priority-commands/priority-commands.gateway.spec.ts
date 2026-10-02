import { priorityCommandSchema } from '@openad/mqtt-contracts';
import { PriorityCommandsGateway } from './priority-commands.gateway';

describe('PriorityCommandsGateway', () => {
  const makeGateway = () => {
    const mqtt = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
    };
    const gateway = new PriorityCommandsGateway(mqtt as never);
    return { gateway, mqtt };
  };

  it('sendPriorityCommand publishes to device topic when targetDeviceId is set', async () => {
    const { gateway, mqtt } = makeGateway();
    const cmd = priorityCommandSchema.parse({
      commandId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      mediaId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      priority: 'emergency',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      targetDeviceId: 'b2c3d4e5-f6a7-4890-b123-456789abcdef',
    });

    await gateway.sendPriorityCommand(cmd);

    expect(mqtt.publish).toHaveBeenCalledWith(
      `devices/${cmd.targetDeviceId}/priority`,
      expect.stringContaining(cmd.commandId),
      1,
      false
    );
  });

  it('sendPriorityCommand publishes to broadcast topic when broadcast is true', async () => {
    const { gateway, mqtt } = makeGateway();
    const cmd = priorityCommandSchema.parse({
      commandId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      mediaId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      priority: 'high',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      broadcast: true,
    });

    await gateway.sendPriorityCommand(cmd);

    expect(mqtt.publish).toHaveBeenCalledWith(
      'openad/priority/broadcast',
      expect.any(String),
      1,
      false
    );
  });

  it('onModuleInit subscribes to priority ack wildcard', () => {
    const { gateway, mqtt } = makeGateway();
    gateway.onModuleInit();
    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'devices/+/priority/ack',
      expect.any(Function),
      1
    );
  });
});
