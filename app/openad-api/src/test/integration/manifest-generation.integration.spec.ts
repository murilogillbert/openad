import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { MediaAsset } from '../../modules/media-ingestion/schemas/media-asset.schema';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { InMemoryAssetStorageService } from '../in-memory-asset-storage.service';
import {
  createTestApp,
  seedBoundDeviceForVehicle,
  seedActiveVehicle,
  shutdownTestApp,
  signDeviceAccessToken,
  type TestAppContext,
} from '../test-app.factory';

describe('manifest generation (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('POST /manifest returns media list; second call with lastManifestVersion can return delta', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    const mediaModel = ctx.app.get(getModelToken(MediaAsset.name));
    const mid = randomUUID();
    const storageUrl = `memory:media/${mid}.mp4`;
    await mediaModel.create({
      mediaId: mid,
      hash: 'b'.repeat(64),
      filename: 't.mp4',
      fileSize: 500,
      bitrate: 1_000_000,
      width: 640,
      height: 480,
      codec: 'h264',
      duration: 45,
      categorization: 'universal',
      storageUrl,
      isActive: true,
    });
    (ctx.app.get(AssetStorageService) as InMemoryAssetStorageService).seedStorageUrl(
      storageUrl
    );

    const first = await request(ctx.app.getHttpServer())
      .post('/api/v1/manifest')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceId,
        deviceState: { timestamp: new Date().toISOString() },
      });
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);
    expect(first.body.data.isDelta).toBe(false);
    expect(first.body.data.media?.length).toBe(1);
    expect(first.body.data.spatial).toBeDefined();
    expect(Array.isArray(first.body.data.spatial.entries)).toBe(true);
    const v1 = first.body.data.version as string;

    const second = await request(ctx.app.getHttpServer())
      .post('/api/v1/manifest')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceId,
        lastManifestVersion: v1,
        deviceState: { timestamp: new Date().toISOString() },
      });
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.data.isDelta).toBe(true);
    expect(Array.isArray(second.body.data.operations)).toBe(true);
  });

  it('POST /manifest lists active media regardless of device position (targeting is campaign-level)', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    const mediaModel = ctx.app.get(getModelToken(MediaAsset.name));
    const mid = randomUUID();
    const storageUrl2 = `memory:media/${mid}.mp4`;
    await mediaModel.create({
      mediaId: mid,
      hash: 'c'.repeat(64),
      filename: 'geo.mp4',
      fileSize: 500,
      bitrate: 1_000_000,
      width: 640,
      height: 480,
      codec: 'h264',
      duration: 45,
      categorization: 'universal',
      storageUrl: storageUrl2,
      isActive: true,
    });
    (ctx.app.get(AssetStorageService) as InMemoryAssetStorageService).seedStorageUrl(
      storageUrl2
    );

    const ts = new Date().toISOString();
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/manifest')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceId,
        deviceState: { latitude: 5, longitude: 5, timestamp: ts },
      });
    expect(res.status).toBe(200);
    const ids = (res.body.data.media ?? []).map(
      (m: { mediaId: string }) => m.mediaId
    );
    expect(ids).toContain(mid);
  });

  it('POST /manifest/sync-status persists', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/manifest/sync-status')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceId,
        manifestVersion: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
        downloadedMedia: [],
        storageUsed: 0,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
