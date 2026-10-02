import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Device } from '../../modules/devices/devices.schema';
import {
  createTestApp,
  loginAsFleetOperator,
  seedActiveVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('GET /api/v1/vehicles/:id app release on bound device (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('exposes currentRelease and updateState on vehicle detail', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app, {
      registrationPlate: `AR-${randomUUID().slice(0, 8)}`,
    });
    const token = await loginAsFleetOperator(ctx.app);
    const reg = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${token}`)
      .send({ serialNumber: `SN-AR-${randomUUID().slice(0, 8)}` });
    expect(reg.status).toBe(201);
    const deviceId = reg.body.deviceId as string;
    const pair = await request(ctx.app.getHttpServer())
      .post(`/api/v1/vehicles/${encodeURIComponent(vehicleId)}/pair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId });
    expect(pair.status).toBe(201);

    const deviceModel = ctx.app.get(getModelToken(Device.name));
    await deviceModel.updateOne(
      { deviceId },
      {
        $set: {
          currentRelease: {
            versionIdentifier: '2.0.0',
            installedAt: new Date(),
          },
          updateState: {
            lastCheckAt: new Date(),
            lastCheckResult: 'up_to_date',
            lastError: null,
          },
        },
      }
    );

    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/vehicles/${encodeURIComponent(vehicleId)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.boundDevice?.currentRelease?.versionIdentifier).toBe('2.0.0');
    expect(res.body.boundDevice?.updateState?.lastCheckResult).toBe('up_to_date');
  });
});
