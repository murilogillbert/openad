import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  loginAsFleetAdmin,
  loginAsFleetOperator,
  seedActiveVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('device onboarding (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('bind → active list → duplicate rejected → decommission → excluded', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app, {
      registrationPlate: `INT-${randomUUID().slice(0, 8)}`,
    });
    const token = await loginAsFleetOperator(ctx.app);
    const serial = `SN-INT-${randomUUID().slice(0, 8)}`;

    const reg = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${token}`)
      .send({ serialNumber: serial });
    expect(reg.status).toBe(201);
    const deviceId = reg.body.deviceId as string;
    const pair = await request(ctx.app.getHttpServer())
      .post(`/api/v1/vehicles/${encodeURIComponent(vehicleId)}/pair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId });
    expect(pair.status).toBe(201);

    const list1 = await request(ctx.app.getHttpServer())
      .get('/api/v1/vehicles')
      .query({ status: 'active' })
      .set('Authorization', `Bearer ${token}`);
    expect(
      list1.body.data.some((v: { vehicleId: string }) => v.vehicleId === vehicleId)
    ).toBe(true);

    const dup = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${token}`)
      .send({ serialNumber: serial });
    expect(dup.status).toBe(409);

    const admin = await loginAsFleetAdmin(ctx.app);
    const dec = await request(ctx.app.getHttpServer())
      .delete(`/api/v1/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(dec.status).toBe(200);

    const list2 = await request(ctx.app.getHttpServer())
      .get('/api/v1/vehicles')
      .query({ status: 'active' })
      .set('Authorization', `Bearer ${token}`);
    expect(
      list2.body.data.some((v: { vehicleId: string }) => v.vehicleId === vehicleId)
    ).toBe(false);

    const unbindTry = await request(ctx.app.getHttpServer())
      .delete(`/api/v1/devices/${deviceId}/bind`)
      .set('Authorization', `Bearer ${admin}`);
    expect(unbindTry.status).toBe(200);
    expect(unbindTry.body.lifecycleState).toBe('Flagged');
  });
});
