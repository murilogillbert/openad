import request from 'supertest';
import {
  createTestApp,
  loginAsCampaignManager,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('Geo-zones REST (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('POST /geo-zones without JWT → 401', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/geo-zones')
      .send({
        name: 'X',
        description: 'x',
        city: 'SaoPaulo',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-46.7, -23.5],
              [-46.6, -23.5],
              [-46.6, -23.6],
              [-46.7, -23.6],
              [-46.7, -23.5],
            ],
          ],
        },
        tags: ['t'],
      });
    expect(res.status).toBe(401);
  });

  it('PATCH /geo-zones/:id without JWT → 401', async () => {
    const res = await request(ctx.app.getHttpServer())
      .patch(
        '/api/v1/geo-zones/550e8400-e29b-41d4-a716-446655440000'
      )
      .send({ name: 'Y' });
    expect(res.status).toBe(401);
  });

  it('POST /geo-zones → 201 and GET lists', async () => {
    const token = await loginAsCampaignManager(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/geo-zones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Ring',
        description: 'test',
        city: 'SaoPaulo',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-46.7, -23.5],
              [-46.6, -23.5],
              [-46.6, -23.6],
              [-46.7, -23.6],
              [-46.7, -23.5],
            ],
          ],
        },
        tags: ['cbd'],
      });

    expect(res.status).toBe(201);
    expect(res.body.zoneId).toBeTruthy();

    const list = await request(ctx.app.getHttpServer())
      .get('/api/v1/geo-zones')
      .query({ city: 'SaoPaulo', tag: 'cbd', page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBeGreaterThanOrEqual(1);
    expect(list.body.data.some((z: { zoneId: string }) => z.zoneId === res.body.zoneId)).toBe(true);
  });
});
