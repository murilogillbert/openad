import request from 'supertest';
import {
  createTestApp,
  loginAsFleetOperator,
  loginAsSuperAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('Releases: release notes visibility (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('releaseNotes are returned on admin list but never on public stable manifest', async () => {
    const token = await loginAsSuperAdmin(ctx.app);

    const up = await request(ctx.app.getHttpServer())
      .post('/api/v1/releases/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('versionIdentifier', '9.9.8')
      .field('releaseNotes', 'Top secret: internal notes')
      .attach('file', Buffer.from('not-a-real-apk'), {
        filename: 'app.apk',
        contentType: 'application/vnd.android.package-archive',
      });
    expect(up.status).toBe(201);

    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    const row = (list.body as Array<{ _id: string; releaseNotes?: string }>).find(
      (r) => r._id === up.body._id
    );
    expect(row?.releaseNotes).toBe('Top secret: internal notes');

    const pub = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(up.body._id)}/publish-stable`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect([200, 201]).toContain(pub.status);

    const manifest = await request(ctx.app.getHttpServer()).get(
      '/api/v1/releases/public/stable-manifest'
    );
    expect(manifest.status).toBe(200);
    expect(JSON.stringify(manifest.body)).not.toContain('releaseNotes');
  });

  it('GET /field-notes is read-only for operators and omits artifacts', async () => {
    const op = await loginAsFleetOperator(ctx.app);
    const fn = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases/field-notes')
      .set('Authorization', `Bearer ${op}`);
    expect(fn.status).toBe(200);
    expect(Array.isArray(fn.body)).toBe(true);
    expect(JSON.stringify(fn.body)).not.toMatch(
      /artifactAccessToken|downloadUrl|_id/gi
    );
  });
});

