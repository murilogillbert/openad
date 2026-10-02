import request from 'supertest';
import Redis from 'ioredis';
import { getModelToken } from '@nestjs/mongoose';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { CommandAckHandler } from '../../modules/fleet-monitor/command-ack.handler';
import { CommandDispatchProcessor } from '../../modules/fleet-monitor/command-dispatch.processor';
import { RemoteCommandRecord } from '../../modules/fleet-monitor/remote-command.schema';
import {
  createTestApp,
  loginAsFleetAdmin,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

async function waitUntil(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number } = {
    timeoutMs: 30_000,
    intervalMs: 50,
  }
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw new Error('waitUntil timeout');
}

describe('Remote command lifecycle (integration)', () => {
  let ctx: TestAppContext;
  let publishSpy: jest.SpyInstance;
  let redisSub: Redis | null = null;

  beforeAll(async () => {
    ctx = await createTestApp();
    const mqtt = ctx.app.get(MqttService);
    publishSpy = jest.spyOn(mqtt, 'publish').mockResolvedValue(undefined);
  }, 120_000);

  afterAll(async () => {
    redisSub?.disconnect();
    await shutdownTestApp(ctx);
  }, 30_000);

  it('issue → dispatched → MQTT ack → acknowledged + Redis pubsub', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetAdmin(ctx.app);

    const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    const messages: string[] = [];
    redisSub = new Redis(redisUrl, { maxRetriesPerRequest: null });
    redisSub.on('message', (_ch, msg) => {
      messages.push(msg);
    });
    await redisSub.subscribe('pubsub:dashboard');

    const post = await request(ctx.app.getHttpServer())
      .post(`/api/v1/fleet/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'RESTART' });

    expect(post.status).toBe(202);
    const commandId = post.body.commandId as string;

    // Deterministic dispatch (avoid coupling to BullMQ worker timing).
    await ctx.app.get(CommandDispatchProcessor).process({
      id: 'test-job',
      data: { commandId },
    } as never);

    const cmdModel = ctx.app.get(getModelToken(RemoteCommandRecord.name));
    await waitUntil(async () => {
      const doc = await cmdModel.findOne({ commandId }).exec();
      return doc?.status === 'Delivered';
    });

    expect(publishSpy).toHaveBeenCalledWith(
      `openad/${deviceId}/commands`,
      expect.objectContaining({ commandId, type: 'RESTART' }),
      1,
      false
    );

    await ctx.app.get(CommandAckHandler).handleAck(
      `openad/${deviceId}/commands/ack`,
      Buffer.from(
        JSON.stringify({
          commandId,
          status: 'success',
          completedAt: new Date().toISOString(),
          details: null,
        }),
        'utf8'
      )
    );

    await waitUntil(async () => {
      const doc = await cmdModel.findOne({ commandId }).exec();
      return doc?.status === 'Acknowledged';
    });

    const final = await cmdModel.findOne({ commandId }).exec();
    expect(final?.status).toBe('Acknowledged');

    await waitUntil(async () =>
      messages.some((m) => m.includes(commandId) && m.includes('command_ack'))
    );
  });
});
