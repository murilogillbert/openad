import request from 'supertest';
import {
  createTestApp,
  loginAsFleetAdmin,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('GET /api/v1/devices/:deviceId/lifecycle-events (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('returns events in descending occurredAt order with pagination', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetAdmin(ctx.app);

    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        toState: 'Suspended',
        reason: 'First transition for lifecycle event list test',
      });

    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/devices/${deviceId}/lifecycle-events`)
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination.page).toBe(1);
    const times = res.body.data.map(
      (e: { occurredAt: string }) => new Date(e.occurredAt).getTime()
    );
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
    const first = res.body.data[0];
    expect(first.fromState).toBeDefined();
    expect(first.toState).toBeDefined();
    expect(first.trigger?.type).toBeDefined();
  });
});
