import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  loginAsCampaignManager,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  signDeviceAccessToken,
  type TestAppContext,
} from '../test-app.factory';

describe('spatial manifest (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('includes overlapping zones with distinct priorityScore in spatial.entries', async () => {
    const mgr = await loginAsCampaignManager(ctx.app);
    const ring = [
      [
        [-122.45, 37.75],
        [-122.45, 37.82],
        [-122.35, 37.82],
        [-122.35, 37.75],
        [-122.45, 37.75],
      ],
    ];
    const mediaA = randomUUID();
    const mediaB = randomUUID();

    const z1 = await request(ctx.app.getHttpServer())
      .post('/api/v1/geo-zones')
      .set('Authorization', `Bearer ${mgr}`)
      .send({
        name: 'Corridor A',
        description: 'test',
        city: 'SF',
        geometry: { type: 'Polygon', coordinates: ring },
        tags: ['spatial-test'],
        tier: 'T2',
        priorityScore: 100,
        bindings: [
          {
            mediaId: mediaA,
            triggerMode: 'entry',
            retriggerCooldownSeconds: 60,
            rotationMode: 'sequential',
          },
        ],
      });
    expect(z1.status).toBe(201);

    const z2 = await request(ctx.app.getHttpServer())
      .post('/api/v1/geo-zones')
      .set('Authorization', `Bearer ${mgr}`)
      .send({
        name: 'Corridor B',
        description: 'test',
        city: 'SF',
        geometry: { type: 'Polygon', coordinates: ring },
        tags: ['spatial-test'],
        tier: 'T3',
        priorityScore: 50,
        bindings: [
          {
            mediaId: mediaB,
            triggerMode: 'dwell',
            dwellSeconds: 20,
            retriggerCooldownSeconds: 120,
            rotationMode: 'weighted_random',
          },
        ],
      });
    expect(z2.status).toBe(201);

    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/manifest')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceId,
        deviceState: { timestamp: new Date().toISOString() },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.spatial).toBeDefined();
    expect(res.body.data.spatial.entries.length).toBeGreaterThanOrEqual(2);
    const scores = res.body.data.spatial.entries.map(
      (e: { priorityScore: number }) => e.priorityScore
    );
    expect(scores).toEqual(expect.arrayContaining([100, 50]));
  });
});
