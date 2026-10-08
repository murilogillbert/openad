import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import passport from 'passport';
import { AssetDownloadGuard } from './asset-download.guard';
import { ESTRATEGIA_FEDERADA, ESTRATEGIA_INTERNA } from '../../auth/ecosystem-token';
import type { AssetUrlService } from '../asset-url.service';

/**
 * Esta suite existe por causa de um defeito que viveu em producao sem aparecer em teste
 * nenhum: a guarda estendia `AuthGuard('jwt')`, e **nao existe** estrategia passport chamada
 * `jwt` neste servico. Toda requisicao sem `exp`+`sig` morria em
 * `Unknown authentication strategy "jwt"` e a rota respondia 500 em vez de 401.
 *
 * O teste que pega isso tem de **falar com o passport de verdade**. Um dublê da guarda ou um
 * `jest.spyOn(super.canActivate)` passaria com o nome errado, porque o nome so e resolvido
 * dentro do passport. Por isso aqui as estrategias sao registradas no passport pelos nomes
 * reais, e a guarda e exercitada contra elas: se o nome pedido divergir do registrado, o
 * passport levanta `Unknown authentication strategy` e o teste quebra.
 */

/**
 * Estrategia minima. O passport faz `Object.create` do objeto registrado e injeta
 * `success`/`fail`/`error`, entao um objeto com `authenticate` basta — nao e preciso herdar
 * de `passport-strategy`.
 */
function estrategia(acao: 'sucesso' | 'falha', papel = 'fleet_admin') {
  return {
    name: 'falsa',
    authenticate(this: {
      success: (u: unknown) => void;
      fail: (c: unknown, s?: number) => void;
    }) {
      if (acao === 'sucesso') this.success({ role: papel });
      else this.fail({ message: 'sem token' }, 401);
    },
  };
}

function registrar(acao: 'sucesso' | 'falha', papel?: string) {
  passport.use(ESTRATEGIA_INTERNA, estrategia(acao, papel) as never);
  passport.use(ESTRATEGIA_FEDERADA, estrategia(acao, papel) as never);
}

function contexto(
  query: Record<string, unknown>,
  params: Record<string, string>
): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { query, params, headers: {} };
  const res = {
    statusCode: 200,
    setHeader: () => undefined,
    end: () => undefined,
  };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => () => undefined,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('AssetDownloadGuard', () => {
  let verifySignedRequest: jest.Mock;
  let guard: AssetDownloadGuard;

  beforeEach(() => {
    verifySignedRequest = jest.fn();
    guard = new AssetDownloadGuard({
      verifySignedRequest,
    } as unknown as AssetUrlService);
  });

  afterEach(() => {
    passport.unuse(ESTRATEGIA_INTERNA);
    passport.unuse(ESTRATEGIA_FEDERADA);
  });

  describe('URL assinada', () => {
    it('libera quando a assinatura confere, sem consultar o passport', async () => {
      // Nenhuma estrategia registrada: se a guarda caisse no passport aqui, o erro seria
      // `Unknown authentication strategy` — o que prova que o atalho da assinatura e tomado.
      const { ctx } = contexto(
        { exp: '9999999999', sig: 'abc' },
        { campaignId: 'c1', assetId: 'a1' }
      );
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(verifySignedRequest).toHaveBeenCalledWith('c1', 'a1', '9999999999', 'abc');
    });

    it('recusa com 401 quando a assinatura nao confere', async () => {
      verifySignedRequest.mockImplementation(() => {
        throw new Error('assinatura invalida');
      });
      const { ctx } = contexto(
        { exp: '9999999999', sig: 'errada' },
        { campaignId: 'c1', assetId: 'a1' }
      );
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('preserva a excecao original quando ela ja e 401', async () => {
      const original = new UnauthorizedException('Asset URL expired');
      verifySignedRequest.mockImplementation(() => {
        throw original;
      });
      const { ctx } = contexto(
        { exp: '1', sig: 'vencida' },
        { campaignId: 'c1', assetId: 'a1' }
      );
      await expect(guard.canActivate(ctx)).rejects.toBe(original);
    });
  });

  describe('sem assinatura: cai no JWT', () => {
    it('pede ao passport as estrategias que de fato existem (nao "jwt")', async () => {
      registrar('falha');
      const { ctx } = contexto({}, { campaignId: 'c1', assetId: 'a1' });

      // O ponto do teste: 401, e NAO um erro de estrategia desconhecida. Antes da correcao
      // isto levantava `Error: Unknown authentication strategy "jwt"`, que o filtro de
      // excecao traduz em 500.
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('nao levanta erro de estrategia desconhecida', async () => {
      registrar('falha');
      const { ctx } = contexto({}, { campaignId: 'c1', assetId: 'a1' });
      await expect(guard.canActivate(ctx)).rejects.not.toThrow(
        /Unknown authentication strategy/
      );
    });

    it('libera operador com papel aceito', async () => {
      registrar('sucesso', 'fleet_admin');
      const { ctx } = contexto({}, { campaignId: 'c1', assetId: 'a1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('recusa com 403 quem autentica mas nao tem papel de frota', async () => {
      // `advertiser` autentica (e um usuario valido) e nao deve baixar criativo de campanha
      // alheia. A diferenca entre 401 e 403 aqui e informativa: a primeira diz "entre", a
      // segunda diz "voce entrou e nao e seu".
      registrar('sucesso', 'advertiser');
      const { ctx } = contexto({}, { campaignId: 'c1', assetId: 'a1' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assinatura pela metade', () => {
    it.each([
      ['so exp', { exp: '9999999999' }],
      ['so sig', { sig: 'abc' }],
    ])('%s cai no JWT em vez de liberar', async (_rotulo, query) => {
      registrar('falha');
      const { ctx } = contexto(query, { campaignId: 'c1', assetId: 'a1' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(verifySignedRequest).not.toHaveBeenCalled();
    });
  });
});
