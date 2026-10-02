import request from 'supertest';
import {
  createTestApp,
  loginAsSuperAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('GET /api/v1/releases/public/stable-manifest (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('returns message when no stable release is published', async () => {
    const res = await request(ctx.app.getHttpServer()).get(
      '/api/v1/releases/public/stable-manifest'
    );
    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
  });

  it('returns downloadUrl after a stable release is published', async () => {
    const token = await loginAsSuperAdmin(ctx.app);
    // Upload a tiny fake APK payload (service only checks .apk extension).
    const up = await request(ctx.app.getHttpServer())
      .post('/api/v1/releases/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('versionIdentifier', '9.9.9')
      .attach('file', Buffer.from('not-a-real-apk'), {
        filename: 'app.apk',
        contentType: 'application/vnd.android.package-archive',
      });
    expect(up.status).toBe(201);
    const releaseId = up.body._id as string;
    expect(releaseId).toBeTruthy();

    const pub = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(releaseId)}/publish-stable`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect([200, 201]).toContain(pub.status);

    const res = await request(ctx.app.getHttpServer()).get(
      '/api/v1/releases/public/stable-manifest'
    );
    expect(res.status).toBe(200);
    expect(res.body.latest?.downloadUrl).toBeTruthy();
  });
});

