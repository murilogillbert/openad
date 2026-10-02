import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { User } from '../auth/schemas/user.schema';
import { UploadSession } from './schemas/upload-session.schema';
import { FolderNode } from './schemas/folder-node.schema';
import { MediaAsset } from './schemas/media-asset.schema';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../../test/test-app.factory';

/**
 * T022 — scope / trust on upload complete (SC-004).
 * T048 — clone / patch deny cross-campaign placement (CAMPAIGN_SCOPE).
 */
describe('media VFS security (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp(ctx);
  });

  it('T022: complete upload session as non-owner returns 403', async () => {
    const userModel = ctx.app.get(getModelToken(User.name));
    const admin = await userModel
      .findOne({ email: 'fleet-admin@test.local' })
      .lean()
      .exec();
    if (!admin) {
      throw new Error('seed fleet-admin missing');
    }
    const sessionId = randomUUID();
    const uploadModel = ctx.app.get(getModelToken(UploadSession.name));
    await uploadModel.create({
      sessionId,
      storageKey: 'openad/vfs/sec-test/key.mp4',
      tenantKeyPrefix: 'openad',
      initiatedBy: admin.userId,
      contentType: 'video/mp4',
      originalFilename: 'x.mp4',
      maxBytes: 999_999_999,
      allowedMimeTypes: ['video/mp4'],
      expiresAt: new Date(Date.now() + 3_600_000),
      status: 'initiated',
    });

    const token = await loginAsCampaignManager(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/media/vfs/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('T048: clone to folder in another campaign returns 403', async () => {
    const folderModel = ctx.app.get(getModelToken(FolderNode.name));
    const mediaModel = ctx.app.get(getModelToken(MediaAsset.name));
    const campaignsRoot = await folderModel
      .findOne({ materializedPath: '/Root/Campaigns' })
      .exec();
    if (!campaignsRoot) {
      throw new Error('bootstrap /Root/Campaigns missing');
    }
    const suf = randomUUID().slice(0, 8);
    const campaignA = randomUUID();
    const campaignB = randomUUID();
    const idA = new Types.ObjectId();
    const idB = new Types.ObjectId();
    await folderModel.create({
      _id: idA,
      name: `SecA_${suf}`,
      parentId: campaignsRoot._id.toString(),
      materializedPath: `/Root/Campaigns/SecA_${suf}`,
      campaignId: campaignA,
      isSystemLocked: false,
    });
    await folderModel.create({
      _id: idB,
      name: `SecB_${suf}`,
      parentId: campaignsRoot._id.toString(),
      materializedPath: `/Root/Campaigns/SecB_${suf}`,
      campaignId: campaignB,
      isSystemLocked: false,
    });
    const mediaId = randomUUID();
    const hash = 'a'.repeat(64);
    await mediaModel.create({
      mediaId,
      hash,
      filename: 'clip.mp4',
      fileSize: 1000,
      bitrate: 1_000_000,
      width: 1920,
      height: 1080,
      codec: 'h264',
      duration: 10,
      categorization: 'universal',
      storageUrl: 'r2:openad/vfs/sec/clip.mp4',
      storageKey: 'openad/vfs/sec/clip.mp4',
      isActive: true,
      folderId: idA.toString(),
      campaignId: campaignA,
      validationStatus: 'approved',
      probeStatus: 'complete',
      vfsSource: 'vfs_presign',
    });

    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/media/vfs/assets/${mediaId}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({ targetFolderId: idB.toString() });
    expect(res.status).toBe(403);
  });

  it('T048: PATCH move to folder in another campaign returns 403', async () => {
    const folderModel = ctx.app.get(getModelToken(FolderNode.name));
    const mediaModel = ctx.app.get(getModelToken(MediaAsset.name));
    const campaignsRoot = await folderModel
      .findOne({ materializedPath: '/Root/Campaigns' })
      .exec();
    if (!campaignsRoot) {
      throw new Error('bootstrap /Root/Campaigns missing');
    }
    const suf = randomUUID().slice(0, 8);
    const campaignA = randomUUID();
    const campaignB = randomUUID();
    const idA = new Types.ObjectId();
    const idB = new Types.ObjectId();
    await folderModel.create({
      _id: idA,
      name: `MvA_${suf}`,
      parentId: campaignsRoot._id.toString(),
      materializedPath: `/Root/Campaigns/MvA_${suf}`,
      campaignId: campaignA,
      isSystemLocked: false,
    });
    await folderModel.create({
      _id: idB,
      name: `MvB_${suf}`,
      parentId: campaignsRoot._id.toString(),
      materializedPath: `/Root/Campaigns/MvB_${suf}`,
      campaignId: campaignB,
      isSystemLocked: false,
    });
    const mediaId = randomUUID();
    const hash = 'b'.repeat(64);
    await mediaModel.create({
      mediaId,
      hash,
      filename: 'move.mp4',
      fileSize: 1000,
      bitrate: 1_000_000,
      width: 1920,
      height: 1080,
      codec: 'h264',
      duration: 10,
      categorization: 'universal',
      storageUrl: 'r2:openad/vfs/sec/move.mp4',
      storageKey: 'openad/vfs/sec/move.mp4',
      isActive: true,
      folderId: idA.toString(),
      campaignId: campaignA,
      validationStatus: 'approved',
      probeStatus: 'complete',
      vfsSource: 'vfs_presign',
    });

    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/media/vfs/assets/${mediaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ folderId: idB.toString() });
    expect(res.status).toBe(403);
  });
});
