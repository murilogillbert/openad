import request from 'supertest';
import {
  createTestApp,
  loginAsSuperAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('Releases: MDM metrics, staged flag, revoke (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('GET /releases/metrics returns numbers (even with no stable)', async () => {
    const token = await loginAsSuperAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases/metrics')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      latestStableVersion: null,
      totalOnLatest: 0,
      pendingNotOnLatest: 0,
      openRolloutWaves: 0,
    });
  });

  it('list includes hasStagedRollout; revoke is blocked for current stable', async () => {
    const token = await loginAsSuperAdmin(ctx.app);
    const up = await request(ctx.app.getHttpServer())
      .post('/api/v1/releases/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('versionIdentifier', '8.8.1')
      .attach('file', Buffer.from('x'), {
        filename: 'app.apk',
        contentType: 'application/vnd.android.package-archive',
      });
    expect(up.status).toBe(201);
    const id = (up.body as { _id: string })._id;

    const list0 = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases')
      .set('Authorization', `Bearer ${token}`);
    expect(list0.status).toBe(200);
    const row0 = (list0.body as Array<{ _id: string; hasStagedRollout: boolean }>).find(
      (r) => r._id === id
    );
    expect(row0?.hasStagedRollout).toBe(false);

    const ro = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(id)}/rollouts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceGroupIds: [], percentage: 20 });
    expect([200, 201]).toContain(ro.status);
    const rolloutId = (ro.body as { _id: string })._id;
    const act = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/releases/rollouts/${encodeURIComponent(rolloutId)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    expect([200, 201]).toContain(act.status);

    const list1 = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases')
      .set('Authorization', `Bearer ${token}`);
    expect(list1.status).toBe(200);
    const row1 = (list1.body as Array<{ _id: string; hasStagedRollout: boolean }>).find(
      (r) => r._id === id
    );
    expect(row1?.hasStagedRollout).toBe(true);

    const pub = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(id)}/publish-stable`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect([200, 201]).toContain(pub.status);

    const block = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(id)}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(block.status).toBe(400);
  });

  it('activating a second rollout pauses the previously active one (single active)', async () => {
    const token = await loginAsSuperAdmin(ctx.app);
    const mk = async (ver: string) => {
      const up = await request(ctx.app.getHttpServer())
        .post('/api/v1/releases/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('versionIdentifier', ver)
        .attach('file', Buffer.from('x'), {
          filename: 'app.apk',
          contentType: 'application/vnd.android.package-archive',
        });
      expect(up.status).toBe(201);
      return (up.body as { _id: string })._id;
    };
    const idA = await mk('9.0.0-sa');
    const idB = await mk('9.0.1-sa');
    const roA = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(idA)}/rollouts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceGroupIds: [], percentage: 10 });
    expect([200, 201]).toContain(roA.status);
    const roB = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(idB)}/rollouts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceGroupIds: [], percentage: 10 });
    expect([200, 201]).toContain(roB.status);
    const rolloutA = (roA.body as { _id: string })._id;
    const rolloutB = (roB.body as { _id: string })._id;

    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/releases/rollouts/${encodeURIComponent(rolloutA)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/releases/rollouts/${encodeURIComponent(rolloutB)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });

    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases/rollouts/list')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const rows = list.body as Array<{ _id: string; status: string }>;
    const a = rows.find((r) => r._id === rolloutA);
    const b = rows.find((r) => r._id === rolloutB);
    expect(b?.status).toBe('active');
    expect(a?.status).toBe('paused');
  });
});
