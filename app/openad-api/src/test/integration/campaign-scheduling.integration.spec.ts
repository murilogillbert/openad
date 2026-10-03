import request from 'supertest';
import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsContentModerator,
  loginAsFleetOperator,
  seedActiveVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';
import { GeoZone } from '../../modules/geo-zones/geo-zone.schema';

describe('Campaign scheduling (integration)', () => {
  let ctx: TestAppContext;
  let publishSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp();
    const mqtt = ctx.app.get(MqttService);
    publishSpy = jest.spyOn(mqtt, 'publish').mockResolvedValue(undefined);
    const redis = ctx.app.get(RedisService);
    jest.spyOn(redis, 'set').mockResolvedValue(undefined);
    jest.spyOn(redis, 'get').mockResolvedValue(null);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('activate publishes schedule to MQTT for bound device in zone', async () => {
    const token = await loginAsCampaignManager(ctx.app);
    const zoneId = randomUUID();

    const gz = ctx.app.get(getModelToken(GeoZone.name));
    await gz.create({
      zoneId,
      name: 'Z',
      description: 'integration zone',
      city: 'C',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-46.7, -23.5],
            [-46.6, -23.5],
            [-46.6, -23.6],
            [-46.7, -23.6],
            [-46.7, -23.5],
          ],
        ],
      },
      tags: [],
    });

    const vehicleId = await seedActiveVehicle(ctx.app, {
      registrationPlate: `INT-${randomUUID().slice(0, 8)}`,
    });

    const opTok = await loginAsFleetOperator(ctx.app);
    const reg = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${opTok}`)
      .send({
        serialNumber: `SN-INT-${randomUUID().slice(0, 8)}`,
      });
    expect(reg.status).toBe(201);
    const deviceId = reg.body.deviceId as string;
    const pairRes = await request(ctx.app.getHttpServer())
      .post(`/api/v1/vehicles/${encodeURIComponent(vehicleId)}/pair`)
      .set('Authorization', `Bearer ${opTok}`)
      .send({ deviceId });
    expect(pairRes.status).toBe(201);

    const c = await request(ctx.app.getHttpServer())
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Int',
        advertiserName: 'Y',
        priority: 1,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86400000 * 30).toISOString(),
        budget: {
          totalAmountCents: 100,
          currency: 'USD',
          ratePerImpressionCents: 1,
        },
      });
    const campaignId = c.body.campaignId as string;

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const up = await request(ctx.app.getHttpServer())
      .post(`/api/v1/campaigns/${campaignId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .field('mimeType', 'image/png')
      .attach('file', png, 'px.png');
    expect(up.status).toBe(201);
    const assetId = up.body.assetId as string;

    await request(ctx.app.getHttpServer())
      .post(`/api/v1/campaigns/${campaignId}/rules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetId,
        geoZoneIds: [zoneId],
        timeWindows: [
          {
            daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
            startTime: '00:00',
            endTime: '23:59',
            timezone: 'UTC',
          },
        ],
        dwellThresholdSeconds: 0,
        priority: 1,
      });

    // `draft -> pending_review -> active`: publicar exige revisao, e aprovar exige
    // moderador — gerente de campanha nao aprova a propria campanha.
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/campaigns/${campaignId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'pending_review' })
      .expect(200);

    const moderatorToken = await loginAsContentModerator(ctx.app);

    publishSpy.mockClear();

    const act = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/campaigns/${campaignId}/status`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ status: 'active' });
    expect(act.status).toBe(200);

    expect(publishSpy).toHaveBeenCalled();
    const call = publishSpy.mock.calls.find((c) =>
      (c[0] as string).includes(`openad/${deviceId}/schedule`)
    );
    expect(call).toBeDefined();
    if (!call) {
      throw new Error('expected MQTT publish to schedule topic');
    }
    const raw = call[1] as object | string;
    const payload =
      typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
    expect(payload.rules?.length).toBeGreaterThan(0);
    expect(payload.rules[0].assetChecksumSha256?.length).toBe(64);
  });
});
