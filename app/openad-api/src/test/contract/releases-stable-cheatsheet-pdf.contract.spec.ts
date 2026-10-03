import request from 'supertest';
import {
  createTestApp,
  loginAsSuperAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('GET /api/v1/releases/stable-cheatsheet.pdf (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  /**
   * Orcamento de 60s, nao os 30s do padrao.
   *
   * Esta e a suite mais pesada do conjunto — gera PDF pela aplicacao inteira — e o
   * `shutdownTestApp` faz `flushall` no Redis compartilhado por todos os workers, cujo custo
   * cresce com o numero de suites em paralelo. Com 105 suites o desligamento passou de 30s e
   * a suite falhava no `afterAll`, apesar de todas as asserções passarem. O que mudou aqui e
   * so o orcamento de desligamento; nada do que a suite verifica.
   */
  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 60_000);

  it('returns 404 when no stable is published', async () => {
    const token = await loginAsSuperAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases/stable-cheatsheet.pdf')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns application/pdf when stable is published', async () => {
    const token = await loginAsSuperAdmin(ctx.app);
    const up = await request(ctx.app.getHttpServer())
      .post('/api/v1/releases/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('versionIdentifier', '7.7.7')
      .attach('file', Buffer.from('not-a-real-apk'), {
        filename: 'app.apk',
        contentType: 'application/vnd.android.package-archive',
      });
    expect(up.status).toBe(201);

    const pub = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(up.body._id)}/publish-stable`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect([200, 201]).toContain(pub.status);

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/releases/stable-cheatsheet.pdf')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const raw = (res.body as Buffer).toString('latin1');
    expect(raw).not.toMatch(/Stable APK URL:/i);
  });
});

