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

describe('Analytics reconciliation (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('overlapping batches with same uniqueEventId yield one billable row', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    // Ensure heartbeat-density fraud rule does not trip (needs >=1 telemetry row in window).
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
    const batchId1 = randomUUID();
    const batchId2 = randomUUID();
    const start = new Date(Date.now() - 90_000);
    const end = new Date(start.getTime() + 60_000);

    const buildBatch = (batchId: string) => ({
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
        },
      ],
    });

    const post = async (batchId: string) =>
      request(ctx.app.getHttpServer())
        .post(`/api/v1/devices/${deviceId}/analytics/play-batches`)
        .set('Authorization', `Bearer ${token}`)
        .send(buildBatch(batchId))
        .expect(202);

    await post(batchId1);
    await post(batchId2);

    // Deterministic reconciliation (avoid coupling to BullMQ worker timing).
    const proc = ctx.app.get(AnalyticsReconciliationProcessor);
    await proc.process({
      id: 'test-job-1',
      data: { deviceId, batchId: batchId1, plays: buildBatch(batchId1).plays },
    } as never);
    await proc.process({
      id: 'test-job-2',
      data: { deviceId, batchId: batchId2, plays: buildBatch(batchId2).plays },
    } as never);

    const model = ctx.app.get(getModelToken(PlayRecord.name));
    let row = null;
    for (let i = 0; i < 60; i++) {
      row = await model.findOne({ uniqueEventId }).exec();
      if (row?.reconciliationStatus === 'billable') {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(row).not.toBeNull();
    expect(row?.reconciliationStatus).toBe('billable');
    const count = await model.countDocuments({ uniqueEventId });
    expect(count).toBe(1);
  });
});
