import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('configuration profiles REST (integration)', () => {
  let ctx: TestAppContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await loginAsFleetAdmin(ctx.app);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  const body = (name: string) => ({
    name,
    exhibitionRules: { maxLoopLengthSeconds: 120, adToContentRatio: 3 },
    connectivityMode: 'Economy' as const,
    commercialTierMultiplier: 1,
  });

  it('POST /configuration-profiles → 201; GET list paginated; GET by id; PATCH; DELETE non-default 204; DELETE default 409', async () => {
    const name = `Api-${randomUUID().slice(0, 8)}`;
    const post = await request(ctx.app.getHttpServer())
      .post('/api/v1/configuration-profiles')
      .set('Authorization', `Bearer ${token}`)
      .send(body(name));
    expect(post.status).toBe(201);
    const profileId = post.body.profileId as string;

    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/configuration-profiles')
      .query({ page: 1, limit: 20 })
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBeGreaterThan(0);
    expect(
      list.body.data.some((p: { profileId: string }) => p.profileId === profileId)
    ).toBe(true);

    const one = await request(ctx.app.getHttpServer())
      .get(`/api/v1/configuration-profiles/${profileId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(one.status).toBe(200);
    expect(one.body.profileId).toBe(profileId);

    const patch = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/configuration-profiles/${profileId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ connectivityMode: 'Premium' });
    expect(patch.status).toBe(200);
    expect(patch.body.connectivityMode).toBe('Premium');

    const del = await request(ctx.app.getHttpServer())
      .delete(`/api/v1/configuration-profiles/${profileId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const defList = await request(ctx.app.getHttpServer())
      .get('/api/v1/configuration-profiles')
      .query({ limit: 500 })
      .set('Authorization', `Bearer ${token}`);
    const def = defList.body.data.find((p: { isDefault: boolean }) => p.isDefault);
    expect(def).toBeTruthy();
    const delDef = await request(ctx.app.getHttpServer())
      .delete(`/api/v1/configuration-profiles/${def.profileId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delDef.status).toBe(409);
  });
});
