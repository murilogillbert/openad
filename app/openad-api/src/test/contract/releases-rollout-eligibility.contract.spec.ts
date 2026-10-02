import request from 'supertest';
import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Device } from '../../modules/devices/devices.schema';
import {
  createTestApp,
  loginAsSuperAdmin,
  shutdownTestApp,
  signDeviceAccessToken,
  type TestAppContext,
} from '../test-app.factory';

describe('Releases: rollout eligibility (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('rollout targeting respects group and percentage rules', async () => {
    const token = await loginAsSuperAdmin(ctx.app);

    const up = await request(ctx.app.getHttpServer())
      .post('/api/v1/releases/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('versionIdentifier', '2.0.0')
      .attach('file', Buffer.from('not-a-real-apk'), {
        filename: 'app.apk',
        contentType: 'application/vnd.android.package-archive',
      });
    expect(up.status).toBe(201);
    const releaseId = up.body._id as string;

    const rollout = await request(ctx.app.getHttpServer())
      .post(`/api/v1/releases/${encodeURIComponent(releaseId)}/rollouts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceGroupIds: ['beta'], percentage: 100 });
    expect([200, 201]).toContain(rollout.status);

    const activate = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/releases/rollouts/${encodeURIComponent(rollout.body._id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    expect(activate.status).toBe(200);

    const deviceModel = ctx.app.get<Model<unknown>>(getModelToken(Device.name));
    const deviceOk = randomUUID();
    const deviceNo = randomUUID();
    const totalGb = 32;
    await deviceModel.create({
      deviceId: deviceOk,
      serialNumber: `SN-${randomUUID().slice(0, 8)}`,
      lifecycleState: 'Active',
      groupId: 'beta',
      boundVehicleId: null,
      boundAt: null,
      hardwareProfile: {
        screenWidthPx: 1920,
        screenHeightPx: 1080,
        screenSizeInches: 10,
        osVersion: 'test',
        storageCapacityGb: totalGb,
      },
      mqttClientId: deviceOk,
      certificateThumbprint: 'a'.repeat(64),
      lastSeenAt: new Date(),
      lastHealthMetrics: null,
      capabilityManifest: null,
    });
    await deviceModel.create({
      deviceId: deviceNo,
      serialNumber: `SN-${randomUUID().slice(0, 8)}`,
      lifecycleState: 'Active',
      groupId: 'prod',
      boundVehicleId: null,
      boundAt: null,
      hardwareProfile: {
        screenWidthPx: 1920,
        screenHeightPx: 1080,
        screenSizeInches: 10,
        osVersion: 'test',
        storageCapacityGb: totalGb,
      },
      mqttClientId: deviceNo,
      certificateThumbprint: 'b'.repeat(64),
      lastSeenAt: new Date(),
      lastHealthMetrics: null,
      capabilityManifest: null,
    });

    const okToken = signDeviceAccessToken(ctx.app, deviceOk);
    const ok = await request(ctx.app.getHttpServer())
      .get(
        `/api/v1/releases/devices/${encodeURIComponent(deviceOk)}/update-manifest?currentVersion=0.0.0`
      )
      .set('Authorization', `Bearer ${okToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.eligible).toBe(true);
    expect(ok.body.target?.versionIdentifier).toBe('2.0.0');

    const noToken = signDeviceAccessToken(ctx.app, deviceNo);
    const no = await request(ctx.app.getHttpServer())
      .get(
        `/api/v1/releases/devices/${encodeURIComponent(deviceNo)}/update-manifest?currentVersion=0.0.0`
      )
      .set('Authorization', `Bearer ${noToken}`);
    expect(no.status).toBe(200);
    expect(no.body.eligible).toBe(false);
    expect(no.body.target).toBeNull();
  });
});

