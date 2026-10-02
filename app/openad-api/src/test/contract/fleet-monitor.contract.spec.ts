import request from 'supertest';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsFleetAdmin,
  loginAsFleetOperator,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('Fleet monitor REST (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    const mqtt = ctx.app.get(MqttService);
    jest.spyOn(mqtt, 'publish').mockResolvedValue(undefined);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('GET /fleet/status returns data for fleet operator', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetOperator(ctx.app);

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/fleet/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.staleBefore).toBeTruthy();
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /fleet/status is forbidden for campaign manager', async () => {
    const token = await loginAsCampaignManager(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/fleet/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('POST + GET fleet commands for fleet admin', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetAdmin(ctx.app);

    const post = await request(ctx.app.getHttpServer())
      .post(`/api/v1/fleet/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'RESTART' });

    expect(post.status).toBe(202);
    expect(post.body.commandId).toBeTruthy();
    expect(post.body.status).toBe('Pending');

    const list = await request(ctx.app.getHttpServer())
      .get(`/api/v1/fleet/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(
      list.body.data.some(
        (c: { commandId: string }) => c.commandId === post.body.commandId
      )
    ).toBe(true);
  });

  it('POST fleet commands forbidden for fleet operator', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetOperator(ctx.app);

    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/fleet/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'RESTART' });

    expect(res.status).toBe(403);
  });
});
