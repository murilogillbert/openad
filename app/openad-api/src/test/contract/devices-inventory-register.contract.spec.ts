import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  loginAsFleetOperator,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('POST /api/v1/devices/inventory-register (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('201 with deviceId and Pending status', async () => {
    const token = await loginAsFleetOperator(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${token}`)
      .send({
        serialNumber: `SN-OK-${randomUUID().slice(0, 8)}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.deviceId).toBeTruthy();
    expect(res.body.status).toBe('Pending');
  });

  it('409 on duplicate serial', async () => {
    const serial = `SN-DUP-${randomUUID().slice(0, 8)}`;
    const token = await loginAsFleetOperator(ctx.app);

    const first = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${token}`)
      .send({ serialNumber: serial });
    expect(first.status).toBe(201);

    const second = await request(ctx.app.getHttpServer())
      .post('/api/v1/devices/inventory-register')
      .set('Authorization', `Bearer ${token}`)
      .send({ serialNumber: serial });
    expect(second.status).toBe(409);
  });
});
