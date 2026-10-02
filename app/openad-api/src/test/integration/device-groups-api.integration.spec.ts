import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  loginAsFleetAdmin,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('device groups REST (integration)', () => {
  let ctx: TestAppContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await loginAsFleetAdmin(ctx.app);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('POST /device-groups, GET list with member counts, PATCH members reassigns devices', async () => {
    const profiles = await request(ctx.app.getHttpServer())
      .get('/api/v1/configuration-profiles')
      .query({ limit: 10 })
      .set('Authorization', `Bearer ${token}`);
    expect(profiles.status).toBe(200);
    const profileId = profiles.body.data.find(
      (p: { isDefault: boolean }) => p.isDefault
    ).profileId as string;

    const name = `Grp-${randomUUID().slice(0, 8)}`;
    const post = await request(ctx.app.getHttpServer())
      .post('/api/v1/device-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, profileId });
    expect(post.status).toBe(201);
    const groupId = post.body.groupId as string;
    expect(post.body.memberCount).toBe(0);

    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/device-groups')
      .query({ page: 1, limit: 50 })
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const row = list.body.data.find(
      (g: { groupId: string }) => g.groupId === groupId
    );
    expect(row?.memberCount).toBe(0);

    const v = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, v);

    const members = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/device-groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceIds: [deviceId] });
    expect(members.status).toBe(200);
    expect(members.body.triggeredConfigSync).toBe(true);
    expect(members.body.configSyncComplete?.groupId).toBe(groupId);
    expect(members.body.addedDeviceIds).toContain(deviceId);

    const one = await request(ctx.app.getHttpServer())
      .get(`/api/v1/device-groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(one.status).toBe(200);
    expect(one.body.memberCount).toBe(1);
  });
});
