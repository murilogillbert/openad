import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import {
  createTestApp,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../../test/test-app.factory';
import { FolderNode } from './schemas/folder-node.schema';

/**
 * T022 / T035 / T036 — lightweight HTTP checks (auth + not-found + locked folder patch).
 */
describe('media VFS HTTP (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp(ctx);
  });

  it('T022: GET asset without token returns 401', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/v1/media/vfs/assets/00000000-0000-4000-8000-000000000001')
      .expect(401);
  });

  it('T022: GET missing asset returns 404', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    await request(ctx.app.getHttpServer())
      .get('/api/v1/media/vfs/assets/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('T035: GET folder tree returns 200 with data array', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/media/vfs/folders/tree')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('T036: PATCH system-locked folder returns 403', async () => {
    const folderModel = ctx.app.get(getModelToken(FolderNode.name));
    const id = new Types.ObjectId();
    const suf = randomUUID().slice(0, 8);
    await folderModel.create({
      _id: id,
      name: `Locked_${suf}`,
      parentId: null,
      materializedPath: `/Root/Locked_${suf}`,
      campaignId: null,
      isSystemLocked: true,
    });
    const token = await loginAsFleetAdmin(ctx.app);
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/media/vfs/folders/${id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'nope' })
      .expect(403);
  });

  it('T048: clone rejects invalid body', async () => {
    const token = await loginAsFleetAdmin(ctx.app);
    await request(ctx.app.getHttpServer())
      .post(
        '/api/v1/media/vfs/assets/00000000-0000-4000-8000-000000000099/clone'
      )
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });
});
