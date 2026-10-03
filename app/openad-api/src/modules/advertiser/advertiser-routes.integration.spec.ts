import { randomUUID } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import {
  createTestApp,
  loginAsCampaignManager,
  loginAsSuperAdmin,
  signEcosystemToken,
  shutdownTestApp,
  type TestAppContext,
} from '../../test/test-app.factory';
import { FederatedIdentityService } from '../auth/federated-identity.service';
import { Campaign } from '../campaigns/campaign.schema';
import { GeoZone } from '../geo-zones/geo-zone.schema';
import { MediaAsset } from '../media-ingestion/schemas/media-asset.schema';

/**
 * Superficie `/api/v1/advertiser/*` contra o banco.
 *
 * O que estas assercoes protegem, em ordem de gravidade:
 *
 * 1. **Isolamento entre parceiros.** Dois anunciantes, e nenhum alcanca a campanha do outro —
 *    nem pela listagem, nem por identificador direto, nem pelo relatorio. Campanha alheia
 *    responde 404, nao 403: "existe, mas nao e sua" confirma o identificador e permite
 *    enumerar o catalogo do concorrente.
 * 2. **Principal interno nao atravessa.** Inclusive `super_admin`, que o `RolesGuard` libera
 *    incondicionalmente — e por isso que `anuncianteDaRequisicao` existe.
 * 3. **Piso de repasse recusado na borda**, com o numero que falta, em vez de na fila humana.
 * 4. **Fila de moderacao nao recebe casca vazia**: submeter sem criativo e 400.
 */
describe('rotas do anunciante (integration)', () => {
  let ctx: TestAppContext;

  // `public.users.id` dos dois parceiros. Nao existem em `openad.users`, o que faz a
  // estrategia interna devolver `null` e a federada ser tentada — exatamente o caminho de
  // producao.
  const PARCEIRO_A = randomUUID();
  const PARCEIRO_B = randomUUID();

  const ANUNCIANTES: Record<
    string,
    { userId: string; email: string; advertiserId: string; legalName: string }
  > = {
    [PARCEIRO_A]: {
      userId: PARCEIRO_A,
      email: 'a@parceiro.test',
      advertiserId: randomUUID(),
      legalName: 'Parceiro A ME',
    },
    [PARCEIRO_B]: {
      userId: PARCEIRO_B,
      email: 'b@parceiro.test',
      advertiserId: randomUUID(),
      legalName: 'Parceiro B ME',
    },
  };

  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      overrides: [
        {
          provide: FederatedIdentityService,
          // Substitui so a consulta ao Postgres. A estrategia, o guard composto e a
          // derivacao do papel continuam sendo o codigo de producao.
          useValue: {
            resolverAnunciante: async (sub: string) =>
              ANUNCIANTES[sub] ?? null,
          },
        },
      ],
    });
    tokenA = signEcosystemToken(ctx.app, PARCEIRO_A, {
      email: 'a@parceiro.test',
    });
    tokenB = signEcosystemToken(ctx.app, PARCEIRO_B, {
      email: 'b@parceiro.test',
    });
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  function corpoDeCampanha(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Promo manha',
      priority: 1,
      scheduledStart: new Date().toISOString(),
      scheduledEnd: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      budget: {
        totalAmountCents: 100_000,
        ratePerImpressionCents: 10,
        currency: 'BRL',
      },
      ...overrides,
    };
  }

  async function criarComo(token: string, overrides = {}) {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send(corpoDeCampanha(overrides));
    expect(res.status).toBe(201);
    return res.body as { campaignId: string; status: string };
  }

  it('cria em rascunho, com dono e repasse no piso', async () => {
    const criada = await criarComo(tokenA);
    expect(criada.status).toBe('draft');

    const model = ctx.app.get(getModelToken(Campaign.name));
    const doc = await model.findOne({ campaignId: criada.campaignId }).lean();
    expect(doc.ownerUserId).toBe(PARCEIRO_A);
    expect(doc.advertiserId).toBe(ANUNCIANTES[PARCEIRO_A].advertiserId);
    // Repasse ausente no corpo herda o piso de `platform_config`, nao fica nulo.
    expect(doc.driverPayout.model).toBe('percent');
    expect(doc.driverPayout.percent).toBeGreaterThan(0);
    // O nome comercial vem do Postgres, nao do corpo: deixar o cliente escolher permitiria
    // um parceiro veicular com o nome de outro.
    expect(doc.advertiserName).toBe('Parceiro A ME');
  });

  it('nao cria em pending_review: a fila so recebe o que tem criativo', async () => {
    const criada = await criarComo(tokenA);
    expect(criada.status).not.toBe('pending_review');
  });

  it('recusa repasse abaixo do piso, com o numero que falta', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(
        corpoDeCampanha({
          driverPayout: { model: 'percent', percent: 0.01 },
        })
      );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('DRIVER_PAYOUT_BELOW_FLOOR');
    expect(res.body.error?.message).toContain('1.0%');
  });

  it('recusa janela invertida', async () => {
    const agora = Date.now();
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(
        corpoDeCampanha({
          scheduledStart: new Date(agora).toISOString(),
          scheduledEnd: new Date(agora - 1000).toISOString(),
        })
      );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_WINDOW');
  });

  it('a listagem de um parceiro nao inclui a campanha do outro', async () => {
    const daA = await criarComo(tokenA);
    const daB = await criarComo(tokenB);

    const listaA = await request(ctx.app.getHttpServer())
      .get('/api/v1/advertiser/campaigns?limit=100')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listaA.status).toBe(200);
    const idsA = (listaA.body.data as Array<{ campaignId: string }>).map(
      (c) => c.campaignId
    );
    expect(idsA).toContain(daA.campaignId);
    expect(idsA).not.toContain(daB.campaignId);

    // O total da paginacao tambem acompanha o escopo. Se contasse o catalogo inteiro, o app
    // pediria paginas que voltariam vazias — e revelaria o tamanho da carteira alheia.
    expect(listaA.body.pagination.total).toBe(idsA.length);
  });

  it('campanha de outro parceiro responde 404, nao 403', async () => {
    const daB = await criarComo(tokenB);
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/advertiser/campaigns/${daB.campaignId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('nao da para submeter a campanha de outro parceiro', async () => {
    const daB = await criarComo(tokenB);
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${daB.campaignId}/submit`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('submeter sem criativo e recusado; com criativo vai para revisao', async () => {
    const criada = await criarComo(tokenA);

    const semCriativo = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${criada.campaignId}/submit`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(semCriativo.status).toBe(400);
    expect(semCriativo.body.error?.code).toBe('NO_CREATIVE');

    await semearCriativo(criada.campaignId, PARCEIRO_A);

    const comCriativo = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${criada.campaignId}/submit`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(comCriativo.status).toBe(201);
    expect(comCriativo.body.status).toBe('pending_review');
    expect(comCriativo.body.creativeCount).toBe(1);
  });

  it('criativo de outro dono na mesma campanha nao conta para submissao', async () => {
    const criada = await criarComo(tokenA);
    // Cenario de defesa: midia institucional (dono nulo) apontando para a campanha. Nao
    // deve habilitar a submissao, senao o anunciante entrega para revisao algo que nao e
    // dele e que ele nao pode trocar.
    await semearCriativo(criada.campaignId, null);

    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${criada.campaignId}/submit`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('NO_CREATIVE');
  });

  it('a sessao de upload nasce amarrada a pasta da campanha', async () => {
    const criada = await criarComo(tokenA);
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${criada.campaignId}/media`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'spot.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(201);
    expect(res.body.data.sessionId).toBeTruthy();
    expect(res.body.data.storageKey).toContain(res.body.data.sessionId);
  });

  it('nao da para abrir sessao de upload na campanha de outro parceiro', async () => {
    const daB = await criarComo(tokenB);
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${daB.campaignId}/media`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'spot.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(404);
  });

  it('token interno de gerente nao entra nas rotas de anunciante', async () => {
    const interno = await loginAsCampaignManager(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${interno}`);
    expect(res.status).toBe(403);
  });

  it('nem super_admin entra, apesar do desvio do RolesGuard', async () => {
    // `RolesGuard.canActivate` tem `if (role === 'super_admin') return true`. Se a garantia
    // fosse so o `@Roles('advertiser')`, um administrador interno criaria campanha com
    // `ownerUserId` apontando para `openad.users` — identificador de outro espaco, invisivel
    // para todo anunciante e indistinguivel de dado corrompido numa auditoria.
    const admin = await loginAsSuperAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${admin}`)
      .send(corpoDeCampanha());
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('ADVERTISER_ONLY');
  });

  it('sem token, 401', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/v1/advertiser/campaigns')
      .expect(401);
  });

  it('token do ecossistema sem linha de anunciante nao autentica', async () => {
    const semAnuncio = signEcosystemToken(ctx.app, randomUUID());
    await request(ctx.app.getHttpServer())
      .get('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${semAnuncio}`)
      .expect(401);
  });

  describe('inventario e estimativa', () => {
    const cidade = `Cidade_${randomUUID().slice(0, 8)}`;

    beforeAll(async () => {
      const gz = ctx.app.get(getModelToken(GeoZone.name));
      await gz.create({
        zoneId: randomUUID(),
        name: 'Centro',
        description: 'zona de teste de inventario',
        city: cidade,
        tier: 'T1',
        isActive: true,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
              [0, 0],
            ],
          ],
        },
        tags: [],
      });
    });

    it('lista zonas com tier, filtrando por cidade', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/advertiser/inventory/zones?city=${cidade}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({ city: cidade, tier: 'T1', name: 'Centro' })
      );
      // Geometria e bindings nao saem: o anunciante compra alcance, nao o mapa operacional.
      expect(res.body.data[0].geometry).toBeUndefined();
      expect(res.body.data[0].bindings).toBeUndefined();
    });

    it('a estimativa avisa quando a segmentacao nao alcanca zona nenhuma', async () => {
      const criada = await criarComo(tokenA, {
        targeting: { cities: ['Cidade_Que_Nao_Existe'] },
      });
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/advertiser/campaigns/${criada.campaignId}/estimate`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.zonesMatched).toBe(0);
      expect(res.body.warnings.join(' ')).toContain('nenhuma zona ativa');
    });

    it('a estimativa conta zonas alcancadas e deriva o teto de veiculacoes', async () => {
      const criada = await criarComo(tokenA, {
        targeting: { cities: [cidade] },
      });
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/advertiser/campaigns/${criada.campaignId}/estimate`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.zonesMatched).toBe(1);
      expect(res.body.citiesMatched).toEqual([cidade]);
      // 100.000 centavos a 10 por veiculacao.
      expect(res.body.maxBillablePlays).toBe(10_000);
      // Janela de 30 dias: o teto diario cobre um trinta avos.
      expect(res.body.maxDailyBillablePlays).toBe(333);
      expect(res.body.currency).toBe('BRL');
    });

    it('nao da para estimar a campanha de outro parceiro', async () => {
      const daB = await criarComo(tokenB);
      await request(ctx.app.getHttpServer())
        .get(`/api/v1/advertiser/campaigns/${daB.campaignId}/estimate`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('nao da para ler o relatorio da campanha de outro parceiro', async () => {
      const daB = await criarComo(tokenB);
      await request(ctx.app.getHttpServer())
        .get(`/api/v1/advertiser/campaigns/${daB.campaignId}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('o relatorio da propria campanha responde em centavos', async () => {
      const criada = await criarComo(tokenA);
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/advertiser/campaigns/${criada.campaignId}/report`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.revenueTotalCents).toBe(0);
      expect(res.body.impressions).toBe(0);
      expect(res.body.currency).toBe('BRL');
    });
  });

  async function semearCriativo(
    campaignId: string,
    ownerUserId: string | null
  ): Promise<void> {
    const media = ctx.app.get(getModelToken(MediaAsset.name));
    await media.create({
      mediaId: randomUUID(),
      hash: randomUUID().replace(/-/g, ''),
      filename: 'spot.mp4',
      fileSize: 1000,
      bitrate: 1_000_000,
      width: 1920,
      height: 1080,
      codec: 'h264',
      duration: 15,
      categorization: 'universal',
      storageUrl: 'r2:openad/vfs/teste/spot.mp4',
      isActive: true,
      campaignId,
      ownerUserId,
      validationStatus: 'approved',
      probeStatus: 'complete',
    });
  }
});
