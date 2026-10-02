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

describe('DELETE /api/v1/vehicles/{vehicleId} (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('200 with affectedCampaigns and excludes from active list', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app, {
      registrationPlate: `DC-${randomUUID().slice(0, 8)}`,
    });

    const adminToken = await loginAsFleetAdmin(ctx.app);
    const del = await request(ctx.app.getHttpServer())
      .delete(`/api/v1/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({
      vehicleId,
      status: 'decommissioned',
    });
    expect(Array.isArray(del.body.affectedCampaigns)).toBe(true);

    const opToken = await loginAsFleetOperator(ctx.app);
    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/vehicles')
      .query({ status: 'active' })
      .set('Authorization', `Bearer ${opToken}`);

    expect(
      list.body.data.some((v: { vehicleId: string }) => v.vehicleId === vehicleId)
    ).toBe(false);
  });
});
