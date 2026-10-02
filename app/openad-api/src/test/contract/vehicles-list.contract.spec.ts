import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  loginAsFleetOperator,
  seedActiveVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('GET /api/v1/vehicles (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('returns paginated data with filters', async () => {
    await seedActiveVehicle(ctx.app, {
      make: 'Volvo',
      registrationPlate: `L-${randomUUID().slice(0, 8)}`,
    });
    await seedActiveVehicle(ctx.app, {
      make: 'Mercedes',
      registrationPlate: `L2-${randomUUID().slice(0, 8)}`,
    });

    const token = await loginAsFleetOperator(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/vehicles')
      .query({ status: 'active', make: 'volvo', page: 1, limit: 50 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.pagination).toMatchObject({
      total: expect.any(Number),
      page: 1,
      limit: 50,
    });
    expect(res.body.data.every((v: { make: string }) => /volvo/i.test(v.make))).toBe(
      true
    );
    expect(res.body.data.every((v: { status: string }) => v.status === 'active')).toBe(
      true
    );
  });

  it('includes boundDevice when device exists', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app, {
      registrationPlate: `BD-${randomUUID().slice(0, 8)}`,
    });
    const token = await loginAsFleetOperator(ctx.app);
    const reg = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${token}`)
      .send({
        serialNumber: `SN-LIST-${randomUUID().slice(0, 8)}`,
      });
    expect(reg.status).toBe(201);
    const deviceId = reg.body.deviceId as string;
    const pair = await request(ctx.app.getHttpServer())
      .post(`/api/v1/vehicles/${encodeURIComponent(vehicleId)}/pair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId });
    expect(pair.status).toBe(201);

    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/vehicles')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${token}`);

    const row = list.body.data.find(
      (v: { vehicleId: string }) => v.vehicleId === vehicleId
    );
    expect(row?.boundDevice?.deviceId).toBeTruthy();
    expect(row?.boundDevice?.lastSeenAt).toBeTruthy();
  });
});
