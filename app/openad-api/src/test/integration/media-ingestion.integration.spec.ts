import { spawnSync } from 'child_process';
import * as path from 'path';
import request from 'supertest';
import {
  createTestApp,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

const hasFfprobe =
  spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0;

const describeFn = hasFfprobe ? describe : describe.skip;

describeFn('media ingestion (integration)', () => {
  let ctx: TestAppContext;
  let token: string;
  const fixture = path.join(__dirname, '../fixtures/valid-sample.mp4');

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await loginAsFleetAdmin(ctx.app);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('POST /media/upload ingests fixture and GET /media/:id returns row', async () => {
    const post = await request(ctx.app.getHttpServer())
      .post('/api/v1/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', fixture, 'ad.mp4');
    expect(post.status).toBe(201);
    expect(post.body.success).toBe(true);
    const mediaId = post.body.data.mediaId as string;
    expect(mediaId).toBeTruthy();

    const one = await request(ctx.app.getHttpServer())
      .get(`/api/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(one.status).toBe(200);
    expect(one.body.data.mediaId).toBe(mediaId);
  });
});
