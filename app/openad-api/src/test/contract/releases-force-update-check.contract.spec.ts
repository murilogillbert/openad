import request from 'supertest';
import {
  createTestApp,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('Force update check (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('Fleet admin is forbidden (super_admin only)', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/releases/devices/device-x/commands/check-app-updates')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

