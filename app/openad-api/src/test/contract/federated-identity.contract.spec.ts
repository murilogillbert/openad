import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  ECOSSISTEMA_AUDIENCE,
  ECOSSISTEMA_ISSUER,
} from '../../modules/auth/ecosystem-token';
import { FederatedIdentityService } from '../../modules/auth/federated-identity.service';
import {
  createTestApp,
  loginAsCampaignManager,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

/**
 * Fiacao da identidade federada, de ponta a ponta pelo HTTP.
 *
 * Os defeitos D1 a D3 deste projeto foram todos de **ligacao entre componentes**, com teste
 * unitario verde dos dois lados. A cadeia de estrategias do passport e exatamente esse tipo
 * de ponto: `JwtAuthGuard` combina `jwt-internal` e `jwt-federated`, e nenhum teste de
 * unidade prova que a segunda e tentada quando a primeira nao reconhece o `sub`.
 *
 * O `FederatedIdentityService` e substituido para nao exigir Postgres; tudo o mais e real —
 * o guard, as duas estrategias, o `RolesGuard` e as rotas.
 */
describe('Identidade federada (contract)', () => {
  let ctx: TestAppContext;
  let jwt: JwtService;

  /** `public.users.id` do parceiro: um UUID do Postgres do hub, nao de `openad.users`. */
  const ID_DO_PARCEIRO = '9f1c8e40-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await createTestApp({
      overrides: [
        {
          provide: FederatedIdentityService,
          useValue: {
            resolverAnunciante: async (userId: string) =>
              userId === ID_DO_PARCEIRO
                ? {
                    userId: ID_DO_PARCEIRO,
                    email: 'parceiro@exemplo.test',
                    advertiserId: 'adv-0001',
                    legalName: 'Acme Publicidade ME',
                  }
                : null,
          },
        },
      ],
    });
    jwt = ctx.app.get(JwtService);
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 60_000);

  /** Token com a forma que o hub emite: `iss`/`aud` do ecossistema e papel do hub. */
  function tokenDoHub(sub: string, role = 'Partner'): Promise<string> {
    return jwt.signAsync(
      { sub, name: 'Parceiro Teste', email: 'parceiro@exemplo.test', role },
      { issuer: ECOSSISTEMA_ISSUER, audience: ECOSSISTEMA_AUDIENCE }
    );
  }

  it('aceita o token do hub e **nega** rota interna: autentica, mas nao autoriza', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/campaigns')
      .set('Authorization', `Bearer ${await tokenDoHub(ID_DO_PARCEIRO)}`);

    // 403 e nao 401 e a afirmacao central: a estrategia federada reconheceu o anunciante
    // (senao seria 401), e o RolesGuard recusou porque `GET /campaigns` e do portal interno.
    // Quando as rotas de `/advertiser` existirem, elas e que aceitarao este principal.
    expect(res.status).toBe(403);
  });

  it('recusa com 401 o token do ecossistema de quem nao e anunciante', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/campaigns')
      .set(
        'Authorization',
        `Bearer ${await tokenDoHub('9f1c8e40-0000-4000-8000-0000000000bb')}`
      );

    // Nenhuma das duas estrategias resolve: nao esta em `openad.users` nem em
    // `ad_advertisers`. Assinatura valida nao basta.
    expect(res.status).toBe(401);
  });

  it('nao concede nada por causa do papel escrito no token', async () => {
    // `super_admin` e o papel que o RolesGuard trata com desvio incondicional. Vindo de um
    // token do hub, nao pode valer nada: o papel do principal federado e sempre `advertiser`.
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/campaigns')
      .set(
        'Authorization',
        `Bearer ${await tokenDoHub(ID_DO_PARCEIRO, 'super_admin')}`
      );

    expect(res.status).toBe(403);
  });

  it('o token interno continua funcionando, com o papel vindo do banco', async () => {
    const token = await loginAsCampaignManager(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/campaigns')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('recusa token interno cujo `sub` nao existe mais em openad.users', async () => {
    // Usuario removido: o token segue com assinatura valida e dentro da validade, mas a
    // estrategia interna resolve o `sub` no banco, entao o acesso cai na hora.
    const token = await jwt.signAsync({
      sub: 'usuario-que-nao-existe',
      email: 'fantasma@openad.local',
      role: 'super_admin',
    });
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/campaigns')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
