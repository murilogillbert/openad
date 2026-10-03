import request from 'supertest';
import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsContentModerator,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';
import { GeoZone } from '../../modules/geo-zones/geo-zone.schema';

describe('Campaigns REST (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    const mqtt = ctx.app.get(MqttService);
    jest.spyOn(mqtt, 'publish').mockResolvedValue(undefined);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('POST /campaigns → 201 draft', async () => {
    const token = await loginAsCampaignManager(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Coffee AM',
        advertiserName: 'Acme',
        priority: 1,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86400000).toISOString(),
        budget: {
          totalAmountCents: 1_000_000,
          currency: 'USD',
          ratePerImpressionCents: 5,
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.campaignId).toBeTruthy();
    expect(res.body.status).toBe('draft');
  });

  it('POST asset + rule + PATCH status active', async () => {
    const token = await loginAsCampaignManager(ctx.app);
    const zoneId = randomUUID();

    const gz = ctx.app.get(getModelToken(GeoZone.name));
    await gz.create({
      zoneId,
      name: 'Downtown',
      description: 'd',
      city: 'Test',
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
      tags: [],
    });

    const c = await request(ctx.app.getHttpServer())
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rule flow',
        advertiserName: 'X',
        priority: 2,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86400000 * 7).toISOString(),
        budget: {
          totalAmountCents: 100,
          currency: 'USD',
          ratePerImpressionCents: 1,
        },
      });
    expect(c.status).toBe(201);
    const campaignId = c.body.campaignId as string;

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const up = await request(ctx.app.getHttpServer())
      .post(`/api/v1/campaigns/${campaignId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .field('mimeType', 'image/png')
      .attach('file', png, 'pixel.png');

    expect(up.status).toBe(201);
    expect(up.body.status).toBe('verified');
    const assetId = up.body.assetId as string;

    const rule = await request(ctx.app.getHttpServer())
      .post(`/api/v1/campaigns/${campaignId}/rules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetId,
        geoZoneIds: [zoneId],
        timeWindows: [
          {
            daysOfWeek: ['MON'],
            startTime: '06:00',
            endTime: '10:00',
            timezone: 'UTC',
          },
        ],
        dwellThresholdSeconds: 30,
        priority: null,
      });
    expect(rule.status).toBe(201);
    expect(rule.body.ruleId).toBeTruthy();

    // Ir ao ar agora passa por revisao: `draft -> pending_review -> active`. Antes dava
    // para publicar direto de `draft`, sem moderacao.
    const submit = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/campaigns/${campaignId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'pending_review' });
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('pending_review');

    // Aprovar exige moderador: gerente de campanha nao aprova a propria campanha.
    const moderatorToken = await loginAsContentModerator(ctx.app);
    const semPermissao = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/campaigns/${campaignId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    expect(semPermissao.status).toBe(403);

    const act = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/campaigns/${campaignId}/status`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ status: 'active' });
    expect(act.status).toBe(200);
    expect(act.body.status).toBe('active');
  });

  it('nao permite publicar sem passar por revisao', async () => {
    const mgrToken = await loginAsCampaignManager(ctx.app);
    const created = await request(ctx.app.getHttpServer())
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        name: 'Sem revisao',
        advertiserName: 'Acme',
        priority: 1,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86_400_000).toISOString(),
        budget: {
          totalAmountCents: 100_000,
          currency: 'BRL',
          ratePerImpressionCents: 100,
        },
      });
    expect(created.status).toBe(201);

    const moderador = await loginAsContentModerator(ctx.app);
    const direto = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/campaigns/${created.body.campaignId}/status`)
      .set('Authorization', `Bearer ${moderador}`)
      .send({ status: 'active' });
    // Nem o moderador publica de `draft`: a transicao em si e invalida.
    expect(direto.status).toBe(400);
  });

  it('recusa fracao de centavo no orcamento', async () => {
    const token = await loginAsCampaignManager(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Fracao',
        advertiserName: 'Acme',
        priority: 1,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86_400_000).toISOString(),
        budget: {
          totalAmountCents: 1000,
          currency: 'BRL',
          // Isto era aceito antes, e o pacing arredondava em silencio. Com `@IsInt` a
          // requisicao e recusada na borda, onde o anunciante ainda pode corrigir.
          ratePerImpressionCents: 0.5,
        },
      });
    expect(res.status).toBe(400);
  });
});
