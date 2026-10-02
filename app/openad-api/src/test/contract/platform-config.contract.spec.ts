import request from 'supertest';
import {
  createTestApp,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

/**
 * Spec 010 — platform configuration (FR-008..013): GET/PUT/restore and shape.
 */
describe('GET/PUT /api/v1/platform-config (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('returns active, defaults, and version', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/platform-config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.version).toBeGreaterThanOrEqual(1);
    expect(res.body.active).toMatchObject({
      mediaLimits: expect.objectContaining({ maxWidth: expect.any(Number) }),
      fleetHealth: expect.objectContaining({ minBatteryPercent: expect.any(Number) }),
      analytics: expect.objectContaining({ enabled: expect.any(Boolean) }),
    });
    expect(res.body.defaults.mediaLimits.maxWidth).toBeDefined();
  });

  it('saves with matching version and bumps version', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    const g0 = await request(ctx.app.getHttpServer())
      .get('/api/v1/platform-config')
      .set('Authorization', `Bearer ${token}`);
    expect(g0.status).toBe(200);
    const v0 = g0.body.version as number;
    const active = { ...g0.body.active };
    const put = await request(ctx.app.getHttpServer())
      .put('/api/v1/platform-config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        version: v0,
        config: {
          ...active,
          mediaLimits: { ...active.mediaLimits, maxWidth: active.mediaLimits.maxWidth },
        },
      });
    expect(put.status).toBe(200);
    expect(put.body.version).toBe(v0 + 1);
  });
});
