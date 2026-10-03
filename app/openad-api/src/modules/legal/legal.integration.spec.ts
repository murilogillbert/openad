import request from 'supertest';
import { createTestApp, shutdownTestApp, type TestAppContext } from '../../test/test-app.factory';

/**
 * Por que estas páginas têm teste de integração.
 *
 * Elas são endereço colado em ficha de loja, e a revisão da Apple **abre** os dois links. O
 * modo de falhar é silencioso e custa uma rodada de revisão: no hub, essas URLs respondiam 200
 * servindo o `index.html` do SPA, que então redirecionava para a home — o revisor veria a
 * página inicial da loja no lugar da política de privacidade, e `curl` não distinguiria.
 *
 * O teste trava o que importa: as rotas existem **fora** do prefixo `api/v1`, respondem HTML,
 * identificam o controlador com razão social e CNPJ (art. 9º da LGPD), e afirmam a declaração
 * de que passageiro não é perfilado — da qual depende o "sem rastreamento para publicidade"
 * declarado pelo app de corridas.
 */
describe('paginas legais (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp(ctx);
  });

  const caminhos = ['/legal/privacidade', '/legal/termos'];

  it.each(caminhos)('%s responde 200 em HTML, sem autenticacao', async (caminho) => {
    const res = await request(ctx.app.getHttpServer()).get(caminho).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text.length).toBeGreaterThan(1000);
  });

  it.each(caminhos)('%s identifica o controlador (razao social, CNPJ, DPO)', async (caminho) => {
    const res = await request(ctx.app.getHttpServer()).get(caminho).expect(200);
    // Razão social, e não nome fantasia: "Open Driver" não é pessoa jurídica.
    expect(res.text).toContain('Heavenbound Systems LTDA');
    expect(res.text).toContain('51.574.461/0001-09');
    expect(res.text).toMatch(/Encarregado pelo tratamento de dados/i);
    expect(res.text).toContain('mailto:');
  });

  it.each(caminhos)('%s NAO fica atras do prefixo api/v1', async (caminho) => {
    // `/api/v1/legal/...` seria um endereço que quebra quando a API ganhar `v2`, e quem
    // descobriria é o revisor abrindo um link morto.
    await request(ctx.app.getHttpServer()).get(`/api/v1${caminho}`).expect(404);
  });

  it('a politica declara que passageiro nao e perfilado', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/legal/privacidade')
      .expect(200);
    // Esta é a afirmação da qual depende o "Rastreamento para publicidade: Não" declarado
    // pelo app de corridas. Se o produto mudar, este teste tem de ser alterado de propósito.
    expect(res.text).toMatch(/n[aã]o h[aá] identifica[cç][aã]o de passageiro/i);
    expect(res.text).toMatch(/n[aã]o h[aá] perfil de audi[eê]ncia/i);
    expect(res.text).toMatch(/IDFA|GAID|identificador de publicidade/i);
  });

  it('os termos dizem que o credito nao e conversivel em dinheiro', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/legal/termos').expect(200);
    // É a razão de `ad_credit_ledger` existir separado da carteira do hub: saldo comprado por
    // compra no aplicativo que virasse dinheiro sacável seria recusado como valor armazenado.
    expect(res.text).toMatch(/n[aã]o [eé] convers[ií]vel em dinheiro/i);
  });

  it('as paginas sao cacheaveis e com CSP fechada', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/legal/privacidade')
      .expect(200);
    expect(res.headers['cache-control']).toContain('max-age=3600');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
