import request from 'supertest';
import {
  createTestApp,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  signDeviceAccessToken,
  type TestAppContext,
} from '../test-app.factory';

describe('GET /api/v1/devices/:deviceId/session (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('200 with boundVehicleId when device is bound to a vehicle', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/devices/${encodeURIComponent(deviceId)}/session`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBe(deviceId);
    expect(res.body.boundVehicleId).toBe(vehicleId);
  });
});
