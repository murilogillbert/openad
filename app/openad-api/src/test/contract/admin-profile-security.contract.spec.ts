import request from 'supertest';
import {
  createTestApp,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

/**
 * Spec 010 — profile & security API surface (FR-001..007).
 */
describe('GET /api/v1/admin/me and sessions (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('returns profile for fleet admin', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/admin/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: 'fleet-admin@test.local',
      role: 'fleet_admin',
    });
    expect(res.body.userId).toBeTruthy();
  });

  it('lists sessions (may be empty if token has no sid)', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/admin/me/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: expect.any(Array) });
  });
});
