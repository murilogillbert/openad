import request from 'supertest';
import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { ReportGenerationWorker } from '../../modules/reporting/report-generation.worker';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsFinanceAnalyst,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';
import { ImpressionEventRecord } from '../../modules/impressions/impression-event.schema';

async function waitUntil(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number } = {
    timeoutMs: 30_000,
    intervalMs: 200,
  }
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw new Error('waitUntil timeout');
}

describe('Proof-of-Play report (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    const mqtt = ctx.app.get(MqttService);
    jest.spyOn(mqtt, 'publish').mockResolvedValue(undefined);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('seeds impressions → report job → ready with totals', async () => {
    const mgr = await loginAsCampaignManager(ctx.app);
    const c = await request(ctx.app.getHttpServer())
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${mgr}`)
      .send({
        name: 'PoP',
        advertiserName: 'Z',
        priority: 1,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86400000 * 60).toISOString(),
        budget: {
          totalAmountCents: 100_000,
          currency: 'USD',
          ratePerImpressionCents: 1,
        },
      });
    expect(c.status).toBe(201);
    const campaignId = c.body.campaignId as string;

    const imp = ctx.app.get(getModelToken(ImpressionEventRecord.name));
    const vehicleId = '11111111-2222-4333-8444-555555555555';
    const docs = Array.from({ length: 100 }, () => ({
      eventId: randomUUID(),
      campaignId,
      scheduleRuleId: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      assetId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      vehicleId,
      deviceId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
      playedAt: new Date(),
      receivedAt: new Date(),
      durationPlayedSeconds: 2,
      location: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
      accuracyMeters: 1,
      locationVerified: true,
      billingValueCents: 1,
      currency: 'USD',
      mqttDeliveryId: null,
    }));
    await imp.insertMany(docs);

    const token = await loginAsFinanceAnalyst(ctx.app);
    const post = await request(ctx.app.getHttpServer())
      .post('/api/v1/reports/proof-of-play')
      .set('Authorization', `Bearer ${token}`)
      .send({ campaignId, format: 'json' });
    expect(post.status).toBe(201);
    const jobId = post.body.reportJobId as string;

    // Deterministic generation (avoid coupling to BullMQ worker timing).
    await ctx.app.get(ReportGenerationWorker).process({
      id: 'test-job',
      data: { jobId },
    } as never);

    await waitUntil(async () => {
      const st = await request(ctx.app.getHttpServer())
        .get(`/api/v1/reports/${jobId}`)
        .set('Authorization', `Bearer ${token}`);
      return st.status === 200 && st.body.status === 'ready';
    });

    const st = await request(ctx.app.getHttpServer())
      .get(`/api/v1/reports/${jobId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(st.body.summary.totalImpressions).toBe(100);
    // 100 veiculacoes a 1 centavo. Em float, somar 0.01 cem vezes da 1.0000000000000007 —
    // razao pela qual a assercao anterior precisava de `toBeCloseTo`. Em inteiro, 100 e 100.
    expect(st.body.summary.totalBillableValueCents).toBe(100);
  });
});
