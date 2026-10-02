import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsFinanceAnalyst,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';
import { ImpressionEventRecord } from '../../modules/impressions/impression-event.schema';

describe('Reporting REST (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    const mqtt = ctx.app.get(MqttService);
    jest.spyOn(mqtt, 'publish').mockResolvedValue(undefined);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('POST proof-of-play + GET job status', async () => {
    const mgr = await loginAsCampaignManager(ctx.app);
    const c = await request(ctx.app.getHttpServer())
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${mgr}`)
      .send({
        name: 'Rpt',
        advertiserName: 'X',
        priority: 1,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86400000 * 30).toISOString(),
        budget: { totalAmount: 1, currency: 'USD', ratePerImpression: 0.05 },
      });
    expect(c.status).toBe(201);
    const campaignId = c.body.campaignId as string;

    const token = await loginAsFinanceAnalyst(ctx.app);
    const post = await request(ctx.app.getHttpServer())
      .post('/api/v1/reports/proof-of-play')
      .set('Authorization', `Bearer ${token}`)
      .send({ campaignId, format: 'json' });
    expect(post.status).toBe(201);
    expect(post.body.reportJobId).toBeTruthy();

    const job = await request(ctx.app.getHttpServer())
      .get(`/api/v1/reports/${post.body.reportJobId as string}`)
      .set('Authorization', `Bearer ${token}`);
    expect(job.status).toBe(200);
    expect(job.body.reportJobId).toBe(post.body.reportJobId);
    expect(['queued', 'processing', 'ready', 'failed']).toContain(job.body.status);
  });

  it('GET impressions/:eventId', async () => {
    const token = await loginAsFinanceAnalyst(ctx.app);
    const model = ctx.app.get(getModelToken(ImpressionEventRecord.name));
    const eventId = '11111111-1111-4111-8111-111111111111';
    await model.create({
      eventId,
      campaignId: '22222222-2222-4222-8222-222222222222',
      scheduleRuleId: '33333333-3333-4333-8333-333333333333',
      assetId: '44444444-4444-4444-8444-444444444444',
      vehicleId: '55555555-5555-4555-8555-555555555555',
      deviceId: '66666666-6666-4666-8666-666666666666',
      playedAt: new Date(),
      receivedAt: new Date(),
      durationPlayedSeconds: 5,
      location: { type: 'Point', coordinates: [-46.6, -23.5] },
      accuracyMeters: 10,
      locationVerified: true,
      billingValue: 0.05,
      currency: 'USD',
      mqttDeliveryId: null,
    });

    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/reports/impressions/${eventId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.eventId).toBe(eventId);
  });

  it('GET billing requires from/to', async () => {
    const token = await loginAsFinanceAnalyst(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/reports/billing')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('GET billing returns structure', async () => {
    const token = await loginAsFinanceAnalyst(ctx.app);
    const from = new Date(Date.now() - 86400000).toISOString();
    const to = new Date().toISOString();
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/reports/billing?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.period).toBeDefined();
    expect(Array.isArray(res.body.byCampaign)).toBe(true);
    expect(Array.isArray(res.body.byOperator)).toBe(true);
  });
});
