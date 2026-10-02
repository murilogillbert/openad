import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { TELEMETRY_STREAM_KEY } from '../../modules/analytics/constants/telemetry-stream.constants';
import { PlayRecord } from '../../modules/analytics/schemas/play-record.schema';
import { AnalyticsReconciliationProcessor } from '../../modules/analytics/processors/analytics-reconciliation.processor';
import {
  createTestApp,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  signDeviceAccessToken,
  type TestAppContext,
} from '../test-app.factory';

describe('Analytics play batch ingest (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('accepts JSON batch, enqueues, persists play_records', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    const redis = ctx.app.get(RedisService);
    await redis.getClient().xadd(
      TELEMETRY_STREAM_KEY,
      '*',
      'deviceId',
      deviceId,
      'payload',
      '{}'
    );

    const uniqueEventId = randomUUID();
    const campaignId = randomUUID();
    const batchId = randomUUID();
    const start = new Date(Date.now() - 30_000);
    const end = new Date(start.getTime() + 15_000);
    const batch = {
      schemaVersion: 1,
      batchId,
      deviceId,
      plays: [
        {
          uniqueEventId,
          deviceId,
          vehicleId,
          campaignId,
          timestampStart: start.toISOString(),
          timestampEnd: end.toISOString(),
          latStart: -23.55,
          lngStart: -46.63,
          latEnd: -23.551,
          lngEnd: -46.631,
          triggerReason: 'Standard_Loop',
          batteryLevel: 80,
          networkType: '5G',
          gpsAccuracyM: 12,
          displayLux: 400,
        },
      ],
    };

    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/analytics/play-batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(batch)
      .expect(202);

    expect(res.body.acceptedCount).toBe(1);
    expect(res.body.enqueued).toBe(true);

    // Deterministic reconciliation (avoid coupling to BullMQ worker timing).
    await ctx.app.get(AnalyticsReconciliationProcessor).process({
      id: 'test-job',
      data: { deviceId, batchId, plays: batch.plays },
    } as never);

    const model = ctx.app.get(getModelToken(PlayRecord.name));
    let found = null;
    for (let i = 0; i < 400; i++) {
      found = await model.findOne({ uniqueEventId }).exec();
      if (found?.reconciliationStatus === 'billable') {
        break;
      }
      if (found && found.reconciliationStatus !== 'pending') {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).not.toBeNull();
    expect(found?.reconciliationStatus).toBe('billable');
  });
});
