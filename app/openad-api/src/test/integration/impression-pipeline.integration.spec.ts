import { getModelToken } from '@nestjs/mongoose';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ImpressionStreamConsumer } from '../../modules/impressions/impression-stream.consumer';
import { ImpressionEventRecord } from '../../modules/impressions/impression-event.schema';
import { IMPRESSIONS_STREAM } from '../../modules/impressions/impression-ingestion.service';
import {
  createTestApp,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';
import { Campaign } from '../../modules/campaigns/campaign.schema';

describe('Impression pipeline (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    const mqtt = ctx.app.get(MqttService);
    jest.spyOn(mqtt, 'publish').mockResolvedValue(undefined);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('stream → consumer → Mongo; dedup on duplicate eventId', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);

    const campaignId = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const cm = ctx.app.get(getModelToken(Campaign.name));
    await cm.create({
      campaignId,
      name: 'Imp',
      advertiserName: 'Y',
      status: 'active',
      priority: 1,
      budget: { totalAmount: 100, currency: 'USD', ratePerImpression: 0.07 },
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 86400000 * 30),
      createdBy: null,
    });

    const eventId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const ts = new Date().toISOString();
    const body = JSON.stringify({
      deviceId,
      impression: {
        eventId,
        ts,
        campaignId,
        scheduleRuleId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
        assetId: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
        durationPlayedSeconds: 3,
        location: {
          lat: -23.5,
          lng: -46.6,
          accuracyMeters: 5,
          gpsLocked: true,
        },
      },
    });

    const redis = ctx.app.get(RedisService);
    await redis.xadd(IMPRESSIONS_STREAM, '*', 'payload', body);

    const consumer = ctx.app.get(ImpressionStreamConsumer);
    await consumer.drainStream();

    const impModel = ctx.app.get(getModelToken(ImpressionEventRecord.name));
    const one = await impModel.findOne({ eventId }).exec();
    expect(one).not.toBeNull();
    expect(one?.billingValue).toBeCloseTo(0.07);

    await redis.xadd(IMPRESSIONS_STREAM, '*', 'payload', body);
    await consumer.drainStream();

    const count = await impModel.countDocuments({ eventId });
    expect(count).toBe(1);
  });
});
