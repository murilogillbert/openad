import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsContentModerator,
  loginAsFleetOperator,
  signEcosystemToken,
  shutdownTestApp,
  type TestAppContext,
} from '../../test/test-app.factory';
import { FederatedIdentityService } from '../auth/federated-identity.service';
import { Campaign } from '../campaigns/campaign.schema';
import { MediaAsset } from '../media-ingestion/schemas/media-asset.schema';

/**
 * Fila e decisao de moderacao, de ponta a ponta.
 *
 * O caminho completo exercitado aqui — anunciante cria, sobe criativo, submete; moderador ve
 * na fila e aprova; a campanha vai para `active` — e o que a Fase C existe para entregar, e
 * era **inalcancavel** antes desta leva por dois motivos independentes: nao havia fila nem
 * rota de decisao, e a verificacao de ativacao exigia regra de agendamento, que a campanha de
 * anunciante nao tem.
 */
describe('rotas de moderacao (integration)', () => {
  let ctx: TestAppContext;

  const PARCEIRO = randomUUID();
  const ANUNCIANTE = {
    userId: PARCEIRO,
    email: 'parceiro@moderacao.test',
    advertiserId: randomUUID(),
    legalName: 'Parceiro Moderado ME',
  };

  let tokenAnunciante: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      overrides: [
        {
          provide: FederatedIdentityService,
          useValue: {
            resolverAnunciante: async (sub: string) =>
              sub === PARCEIRO ? ANUNCIANTE : null,
          },
        },
      ],
    });
    tokenAnunciante = signEcosystemToken(ctx.app, PARCEIRO, {
      email: ANUNCIANTE.email,
    });
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  /** Cria, sobe criativo e submete — devolve a campanha ja em `pending_review`. */
  async function campanhaEmRevisao(
    overrides: Record<string, unknown> = {}
  ): Promise<string> {
    const criada = await request(ctx.app.getHttpServer())
      .post('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${tokenAnunciante}`)
      .send({
        name: 'Campanha para revisar',
        priority: 1,
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 86_400_000 * 30).toISOString(),
        budget: {
          totalAmountCents: 50_000,
          ratePerImpressionCents: 5,
          currency: 'BRL',
        },
        ...overrides,
      });
    expect(criada.status).toBe(201);
    const campaignId = criada.body.campaignId as string;

    const media = ctx.app.get(getModelToken(MediaAsset.name));
    await media.create({
      mediaId: randomUUID(),
      hash: randomUUID().replace(/-/g, ''),
      filename: 'spot.mp4',
      fileSize: 2048,
      bitrate: 1_000_000,
      width: 1920,
      height: 1080,
      codec: 'h264',
      duration: 15,
      categorization: 'universal',
      storageUrl: 'r2:openad/vfs/teste/spot.mp4',
      mimeType: 'video/mp4',
      isActive: true,
      campaignId,
      ownerUserId: PARCEIRO,
      validationStatus: 'approved',
      probeStatus: 'complete',
    });

    const submetida = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${campaignId}/submit`)
      .set('Authorization', `Bearer ${tokenAnunciante}`);
    expect(submetida.status).toBe(201);
    return campaignId;
  }

  it('a fila lista a campanha submetida, com criativo e prontidao', async () => {
    const campaignId = await campanhaEmRevisao();
    const token = await loginAsContentModerator(ctx.app);

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/moderation/queue')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const item = (res.body.data as Array<{ campaignId: string }>).find(
      (i) => i.campaignId === campaignId
    ) as Record<string, unknown> | undefined;
    expect(item).toBeDefined();
    // O moderador precisa ver o criativo para decidir; fila sem criativo e so uma lista de
    // nomes.
    expect((item?.creatives as unknown[]).length).toBe(1);
    expect(item?.ownerUserId).toBe(PARCEIRO);
    // E precisa saber de antemao se a aprovacao vai passar: sem isto o 400 chega depois do
    // clique, sem explicacao visivel na tela.
    expect(item?.readyToActivate).toBe(true);
    expect(item?.readinessReason).toBeNull();
    // O repasse entra na fila: e parte do que esta sendo aprovado.
    expect(item?.driverPayout).toEqual(
      expect.objectContaining({ model: 'percent' })
    );
  });

  it('a fila nao mostra campanha que nao esta em revisao', async () => {
    const campaignId = await campanhaEmRevisao();
    const token = await loginAsContentModerator(ctx.app);

    await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve' })
      .expect(201);

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/moderation/queue?limit=25')
      .set('Authorization', `Bearer ${token}`);
    const ids = (res.body.data as Array<{ campaignId: string }>).map(
      (i) => i.campaignId
    );
    expect(ids).not.toContain(campaignId);
  });

  it('aprovar leva a campanha ao ar e registra quem decidiu', async () => {
    const campaignId = await campanhaEmRevisao();
    const token = await loginAsContentModerator(ctx.app);

    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');

    const model = ctx.app.get(getModelToken(Campaign.name));
    const doc = await model.findOne({ campaignId }).lean();
    expect(doc.status).toBe('active');
    expect(doc.moderation.decision).toBe('approved');
    expect(doc.moderation.reviewedByUserId).toBeTruthy();
    expect(doc.moderation.reviewedByUserId).not.toBe('unknown');
  });

  it('recusar exige motivo, e o motivo chega ao anunciante', async () => {
    const campaignId = await campanhaEmRevisao();
    const token = await loginAsContentModerator(ctx.app);

    const semMotivo = await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'reject' });
    expect(semMotivo.status).toBe(400);
    expect(semMotivo.body.error?.code).toBe('REASON_REQUIRED');

    const comMotivo = await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'reject', reason: 'Criativo com texto ilegivel a 3 metros' });
    expect(comMotivo.status).toBe(201);
    expect(comMotivo.body.status).toBe('rejected');

    // O anunciante tem de ver o motivo para corrigir — e nao tem de ver quem recusou.
    const visao = await request(ctx.app.getHttpServer())
      .get(`/api/v1/advertiser/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${tokenAnunciante}`);
    expect(visao.status).toBe(200);
    expect(visao.body.status).toBe('rejected');
    expect(visao.body.moderation.decision).toBe('rejected');
    expect(visao.body.moderation.reason).toContain('ilegivel');
    expect(visao.body.moderation.reviewedByUserId).toBeUndefined();
  });

  it('campanha recusada pode ser reenviada para revisao', async () => {
    const campaignId = await campanhaEmRevisao();
    const token = await loginAsContentModerator(ctx.app);
    await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'reject', reason: 'Trocar o criativo' })
      .expect(201);

    const reenvio = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${campaignId}/submit`)
      .set('Authorization', `Bearer ${tokenAnunciante}`);
    expect(reenvio.status).toBe(201);
    expect(reenvio.body.status).toBe('pending_review');
  });

  it('decidir duas vezes nao sobrescreve a primeira decisao', async () => {
    const campaignId = await campanhaEmRevisao();
    const token = await loginAsContentModerator(ctx.app);

    await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'reject', reason: 'Fora da politica de conteudo' })
      .expect(201);

    // A tela mostra um retrato de segundos atras: dois moderadores podem abrir o mesmo item.
    // Sem esta guarda, o segundo clique reverteria a recusa para aprovacao sem rastro.
    const segunda = await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve' });
    expect(segunda.status).toBe(400);
    expect(segunda.body.error?.code).toBe('NOT_IN_REVIEW');

    const model = ctx.app.get(getModelToken(Campaign.name));
    const doc = await model.findOne({ campaignId }).lean();
    expect(doc.status).toBe('rejected');
  });

  it('aprovar campanha sem conteudo entregavel e recusado, com o motivo', async () => {
    // Submeter exige criativo, entao esta campanha chega a revisao com criativo e o perde:
    // e o caso de a midia ser desativada entre a submissao e a decisao.
    const campaignId = await campanhaEmRevisao();
    const media = ctx.app.get(getModelToken(MediaAsset.name));
    await media.updateMany({ campaignId }, { $set: { isActive: false } });

    const token = await loginAsContentModerator(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('NOT_READY_TO_ACTIVATE');
    expect(res.body.error?.message).toContain('conteudo entregavel');
  });

  it('gerente de campanha nao alcanca a fila nem a decisao', async () => {
    const campaignId = await campanhaEmRevisao();
    const gerente = await loginAsCampaignManager(ctx.app);

    await request(ctx.app.getHttpServer())
      .get('/api/v1/moderation/queue')
      .set('Authorization', `Bearer ${gerente}`)
      .expect(403);

    // Quem cria campanha nao aprova campanha: do contrario a revisao e decorativa.
    await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${campaignId}/decision`)
      .set('Authorization', `Bearer ${gerente}`)
      .send({ decision: 'approve' })
      .expect(403);
  });

  it('operador de frota tambem nao alcanca', async () => {
    const operador = await loginAsFleetOperator(ctx.app);
    await request(ctx.app.getHttpServer())
      .get('/api/v1/moderation/queue')
      .set('Authorization', `Bearer ${operador}`)
      .expect(403);
  });

  it('o anunciante nao alcanca a propria fila de moderacao', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/v1/moderation/queue')
      .set('Authorization', `Bearer ${tokenAnunciante}`)
      .expect(403);
  });

  it('sem token, 401', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/v1/moderation/queue')
      .expect(401);
  });

  it('campanha inexistente responde 404', async () => {
    const token = await loginAsContentModerator(ctx.app);
    await request(ctx.app.getHttpServer())
      .post(`/api/v1/moderation/campaigns/${randomUUID()}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve' })
      .expect(404);
  });
});
