import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { TELEMETRY_STREAM_KEY } from '../../modules/analytics/constants/telemetry-stream.constants';
import { PlayRecord } from '../../modules/analytics/schemas/play-record.schema';
import { CampaignDailySpend } from '../../modules/analytics/schemas/campaign-daily-spend.schema';
import { Campaign } from '../../modules/campaigns/campaign.schema';
import { ReconciliationService } from '../../modules/analytics/services/reconciliation.service';
import { AnalyticsReconciliationProcessor } from '../../modules/analytics/processors/analytics-reconciliation.processor';
import {
  createTestApp,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  signDeviceAccessToken,
  type TestAppContext,
} from '../test-app.factory';

describe('Analytics reconciliation (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('overlapping batches with same uniqueEventId yield one billable row', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = signDeviceAccessToken(ctx.app, deviceId);

    // Ensure heartbeat-density fraud rule does not trip (needs >=1 telemetry row in window).
    const redis = ctx.app.get(RedisService);
    await redis.getClient().xadd(
      TELEMETRY_STREAM_KEY,
      '*',
      'deviceId',
      deviceId,
      'payload',
      '{}'
    );

    const uniqueEventId = randomUUID();
    const campaignId = randomUUID();
    const batchId1 = randomUUID();
    const batchId2 = randomUUID();
    const start = new Date(Date.now() - 90_000);
    const end = new Date(start.getTime() + 60_000);

    const buildBatch = (batchId: string) => ({
      schemaVersion: 1,
      batchId,
      deviceId,
      plays: [
        {
          uniqueEventId,
          deviceId,
          vehicleId,
          campaignId,
          timestampStart: start.toISOString(),
          timestampEnd: end.toISOString(),
          latStart: -23.55,
          lngStart: -46.63,
          latEnd: -23.551,
          lngEnd: -46.631,
          triggerReason: 'Standard_Loop',
          batteryLevel: 80,
          networkType: '5G',
          gpsAccuracyM: 12,
        },
      ],
    });

    const post = async (batchId: string) =>
      request(ctx.app.getHttpServer())
        .post(`/api/v1/devices/${deviceId}/analytics/play-batches`)
        .set('Authorization', `Bearer ${token}`)
        .send(buildBatch(batchId))
        .expect(202);

    await post(batchId1);
    await post(batchId2);

    // Deterministic reconciliation (avoid coupling to BullMQ worker timing).
    const proc = ctx.app.get(AnalyticsReconciliationProcessor);
    await proc.process({
      id: 'test-job-1',
      data: { deviceId, batchId: batchId1, plays: buildBatch(batchId1).plays },
    } as never);
    await proc.process({
      id: 'test-job-2',
      data: { deviceId, batchId: batchId2, plays: buildBatch(batchId2).plays },
    } as never);

    const model = ctx.app.get(getModelToken(PlayRecord.name));
    let row = null;
    for (let i = 0; i < 60; i++) {
      row = await model.findOne({ uniqueEventId }).exec();
      if (row?.reconciliationStatus === 'billable') {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(row).not.toBeNull();
    expect(row?.reconciliationStatus).toBe('billable');
    const count = await model.countDocuments({ uniqueEventId });
    expect(count).toBe(1);

    /**
     * Uma linha não é uma cobrança.
     *
     * Este teste já existia e passava **antes** da correção da G.1, porque o índice único
     * `(deviceId, uniqueEventId)` sempre garantiu uma linha só. O que ele não cobria é o que
     * custava dinheiro: os dois lotes atravessavam a detecção de transição e somavam o custo
     * duas vezes no gasto diário da campanha.
     *
     * `billingAppliedAt` é a marca de "esta veiculação já foi cobrada". Ela existir prova que
     * a reivindicação aconteceu; o caso abaixo prova que aconteceu uma vez.
     */
    expect(row?.billingAppliedAt).toBeInstanceOf(Date);
  });

  it('o mesmo lote reenviado cobra a campanha uma vez so', async () => {
    /**
     * O caso que a G.1 existe para fechar.
     *
     * O tablet reenvia o lote depois de um timeout — comportamento normal numa frota com rede
     * ruim. Antes, cada reenvio somava o custo de novo no `campaign_daily_spend`: os dois
     * processamentos liam `pending`, os dois enxergavam a transição para `billable`, e os dois
     * cobravam. O repasse ao motorista escapava por ter `referenceId` próprio; o gasto da
     * campanha não tinha proteção nenhuma.
     *
     * O teste processa o **mesmo** lote três vezes e confere o gasto acumulado. Três, e não
     * duas, porque duas poderiam passar por acidente de ordenação.
     */
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);

    const redis = ctx.app.get(RedisService);
    await redis
      .getClient()
      .xadd(TELEMETRY_STREAM_KEY, '*', 'deviceId', deviceId, 'payload', '{}');

    const campaignId = randomUUID();
    const uniqueEventId = randomUUID();
    const batchId = randomUUID();
    const start = new Date(Date.now() - 90_000);
    const end = new Date(start.getTime() + 60_000);

    // A campanha precisa existir e ter tarifa, senão `recordBillablePlayCost` retorna cedo e
    // o teste passaria sem exercitar a cobrança — o modo de falha mais traiçoeiro aqui.
    const RATE_CENTS = 7;
    const campaigns = ctx.app.get(getModelToken(Campaign.name));
    await campaigns.create({
      campaignId,
      advertiserId: randomUUID(),
      name: 'Campanha do teste de cobranca unica',
      advertiserName: 'Anunciante de teste',
      status: 'active',
      priority: 1,
      scheduledStart: new Date(Date.now() - 86_400_000),
      scheduledEnd: new Date(Date.now() + 86_400_000),
      budget: {
        currency: 'BRL',
        totalAmountCents: 100_000,
        ratePerImpressionCents: RATE_CENTS,
      },
    });

    const plays = [
      {
        uniqueEventId,
        deviceId,
        vehicleId,
        campaignId,
        timestampStart: start.toISOString(),
        timestampEnd: end.toISOString(),
        latStart: -23.55,
        lngStart: -46.63,
        latEnd: -23.551,
        lngEnd: -46.631,
        triggerReason: 'Standard_Loop',
        batteryLevel: 80,
        networkType: '5G',
        gpsAccuracyM: 12,
      },
    ];

    const proc = ctx.app.get(AnalyticsReconciliationProcessor);
    for (let i = 0; i < 3; i++) {
      await proc.process({
        id: `reenvio-${i}`,
        data: { deviceId, batchId, plays },
      } as never);
    }

    const plays_ = ctx.app.get(getModelToken(PlayRecord.name));
    const row = await plays_.findOne({ deviceId, uniqueEventId }).lean().exec();
    expect(row?.reconciliationStatus).toBe('billable');
    expect(row?.billingAppliedAt).toBeTruthy();

    const dailySpend = ctx.app.get(getModelToken(CampaignDailySpend.name));
    const gasto = await dailySpend.find({ campaignId }).lean().exec();
    // Uma linha de gasto diário, com o custo de UMA veiculação.
    expect(gasto).toHaveLength(1);
    expect(gasto[0].billableCostCents).toBe(RATE_CENTS);
  });

  it('a reconciliacao nao sobrescreve veredito de fraude ja gravado', async () => {
    /**
     * `reconcileOne` gravava sem condição, e a leitura de `pending` acontece antes da consulta
     * ao asset e da verificação de geocerca. As regras de antifraude escrevem no mesmo
     * documento: um veredito gravado nessa janela era **sobrescrito**, e a veiculação voltava
     * a faturável sem ninguém ter revisto nada.
     *
     * Aqui o veredito é gravado à mão antes de reconciliar, simulando a corrida.
     */
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const uniqueEventId = randomUUID();
    const start = new Date(Date.now() - 90_000);
    const end = new Date(start.getTime() + 60_000);

    const model = ctx.app.get(getModelToken(PlayRecord.name));
    await model.create({
      uniqueEventId,
      deviceId,
      vehicleId,
      campaignId: randomUUID(),
      mediaId: null,
      timestampStart: start,
      timestampEnd: end,
      latStart: -23.55,
      lngStart: -46.63,
      latEnd: -23.551,
      lngEnd: -46.631,
      triggerReason: 'Standard_Loop',
      batteryLevel: 80,
      networkType: '5G',
      gpsAccuracyM: 12,
      ingestedAt: new Date(),
      batchId: randomUUID(),
      reconciliationStatus: 'fraud_velocity',
      billable: false,
    });

    await ctx.app
      .get(ReconciliationService)
      .reconcileOne(deviceId, uniqueEventId);

    const row = await model.findOne({ deviceId, uniqueEventId }).lean().exec();
    expect(row?.reconciliationStatus).toBe('fraud_velocity');
    expect(row?.billable).toBe(false);
  });
});
