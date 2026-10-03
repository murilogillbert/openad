import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { PlayRecord } from '../../modules/analytics/schemas/play-record.schema';
import { Campaign } from '../../modules/campaigns/campaign.schema';
import {
  createTestApp,
  loginAsFleetOperator,
  seedActiveVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('Analytics reporting API (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('GET summary returns impressions and reach matching fixture (SC-003)', async () => {
    const campaignId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const v1 = '11111111-1111-4111-8111-111111111111';
    const v2 = '22222222-2222-4222-8222-222222222222';
    const deviceId = '33333333-3333-4333-8333-333333333333';

    const cm = ctx.app.get(getModelToken(Campaign.name));
    await cm.create({
      campaignId,
      name: 'Rpt',
      advertiserName: 'Z',
      status: 'active',
      priority: 1,
      budget: {
        totalAmountCents: 1000,
        currency: 'USD',
        ratePerImpressionCents: 10,
      },
      scheduledStart: new Date('2026-04-01'),
      scheduledEnd: new Date('2026-06-01'),
      createdBy: null,
    });

    await seedActiveVehicle(ctx.app, { vehicleId: v1 });
    await seedActiveVehicle(ctx.app, { vehicleId: v2 });

    const pr = ctx.app.get(getModelToken(PlayRecord.name));
    const base = {
      campaignId,
      deviceId,
      batchId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      ingestedAt: new Date(),
      batteryLevel: 90,
      networkType: '5G',
      gpsAccuracyM: 10,
      triggerReason: 'Standard_Loop',
      latStart: 0,
      lngStart: 0,
      latEnd: 0,
      lngEnd: 0,
      reconciliationStatus: 'billable',
      billable: true,
      impliedSpeedKmh: null,
      heartbeatRatio: null,
      displayLux: null,
      mediaId: null,
    };

    await pr.create({
      ...base,
      uniqueEventId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
      vehicleId: v1,
      timestampStart: new Date('2026-04-05T10:00:00Z'),
      timestampEnd: new Date('2026-04-05T10:00:30Z'),
    });
    await pr.create({
      ...base,
      uniqueEventId: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
      vehicleId: v1,
      timestampStart: new Date('2026-04-05T11:00:00Z'),
      timestampEnd: new Date('2026-04-05T11:00:30Z'),
    });
    await pr.create({
      ...base,
      uniqueEventId: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
      vehicleId: v2,
      timestampStart: new Date('2026-04-05T12:00:00Z'),
      timestampEnd: new Date('2026-04-05T12:00:30Z'),
    });

    const token = await loginAsFleetOperator(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get(
        `/api/v1/analytics/campaigns/${campaignId}/reporting/summary?from=2026-04-05T00:00:00.000Z&to=2026-04-06T00:00:00.000Z`
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.impressions).toBe(3);
    expect(res.body.reach).toBe(2);
    expect(res.body.currency).toBe('USD');
  });
});
