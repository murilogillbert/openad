import request from 'supertest';
import {
  createTestApp,
  loginAsFleetAdmin,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

const fp = {
  imei: null as string | null,
  serialNumber: 'SN-PAIR-INT-01',
  macAddress: 'AA:BB:CC:DD:EE:99',
};

describe('pairing flow (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('register → admin secret → bind → returns JWT', async () => {
    const reg = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/pairing/register')
      .send({ hardwareFingerprint: fp });
    expect(reg.status).toBe(201);
    const deviceId = reg.body.deviceId as string;
    expect(deviceId).toBeDefined();

    const admin = await loginAsFleetAdmin(ctx.app);
    const sec = await request(ctx.app.getHttpServer())
      .post(`/api/v1/admin/devices/${encodeURIComponent(deviceId)}/pairing-secret`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});
    expect(sec.status).toBe(200);
    const displayCode = sec.body.displayCode as string;
    expect(displayCode.length).toBeGreaterThanOrEqual(4);

    const bind = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/pairing/bind')
      .send({
        deviceId,
        hardwareFingerprint: fp,
        secretCode: displayCode,
      });
    expect(bind.status).toBe(200);
    expect(bind.body.accessToken).toBeDefined();
    expect(bind.body.deviceId).toBe(deviceId);
  });

  it('lists pending pairings for admin', async () => {
    const fp2 = {
      imei: null as string | null,
      serialNumber: 'SN-PENDING-LIST',
      macAddress: 'AA:BB:CC:DD:EE:AA',
    };
    const reg = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/pairing/register')
      .send({ hardwareFingerprint: fp2 });
    expect(reg.status).toBe(201);
    const deviceId = reg.body.deviceId as string;

    const admin = await loginAsFleetAdmin(ctx.app);
    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/admin/devices/pending-pairings')
      .set('Authorization', `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(
      list.body.data.some((d: { deviceId: string }) => d.deviceId === deviceId)
    ).toBe(true);
  });
});
