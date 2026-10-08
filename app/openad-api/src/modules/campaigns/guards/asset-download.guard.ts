import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { isObservable } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { AssetUrlService } from '../asset-url.service';
import {
  ESTRATEGIA_FEDERADA,
  ESTRATEGIA_INTERNA,
} from '../../auth/ecosystem-token';

const JWT_ROLES = new Set([
  'campaign_manager',
  'fleet_admin',
  'fleet_operator',
  'super_admin',
]);

/**
 * Libera o download por URL assinada (`exp` + `sig`) **ou** por JWT de operador.
 *
 * ============================================================================
 * A estrategia tem de ser nomeada, e as duas sao as mesmas do `JwtAuthGuard`
 * ============================================================================
 *
 * Isto era `AuthGuard('jwt')`, e **nao existe** estrategia passport chamada `jwt` neste
 * serviço: as registradas sao `jwt-internal`, `jwt-federated` e `jwt-ecosystem`
 * (`auth/ecosystem-token.ts`). O efeito era que todo pedido sem `exp`+`sig` morria em
 * `Unknown authentication strategy "jwt"` e a rota respondia **500**.
 *
 * Duas consequencias, e a segunda e a que importa:
 *
 * 1. O caminho de JWT desta guarda nunca funcionou. Operador logado no portal clicando para
 *    baixar um criativo recebia 500, nao o arquivo.
 * 2. Pedido sem credencial nenhuma tambem dava 500 em vez de 401. Isso esconde a diferença
 *    entre "nao autenticado" e "o serviço quebrou" justamente na rota que os aparelhos
 *    buscam **sem JWT** — e e o tipo de erro que, num painel de monitoração, aparece como
 *    falha do servidor e manda procurar no lugar errado.
 *
 * Passou a usar a mesma lista do `JwtAuthGuard` (`interna` e `federada`), e nao a de
 * ecossistema: o token de ecossistema serve so a adesao do anunciante e nao deve alcançar
 * dado de campanha.
 *
 * Descoberto pelo smoke da v2 em 2026-10-08, que exigia `401` e recebeu `500`.
 */
@Injectable()
export class AssetDownloadGuard extends AuthGuard([
  ESTRATEGIA_INTERNA,
  ESTRATEGIA_FEDERADA,
]) {
  constructor(private readonly assetUrls: AssetUrlService) {
    super();
  }

  override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const exp = req.query['exp'];
    const sig = req.query['sig'];
    const campaignId = req.params['campaignId'] as string | undefined;
    const assetId = req.params['assetId'] as string | undefined;
    if (
      typeof exp === 'string' &&
      typeof sig === 'string' &&
      campaignId &&
      assetId
    ) {
      try {
        this.assetUrls.verifySignedRequest(campaignId, assetId, exp, sig);
        return true;
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        throw new UnauthorizedException('Invalid asset URL');
      }
    }

    const raw = super.canActivate(context);
    const result = isObservable(raw)
      ? await lastValueFrom(raw)
      : await Promise.resolve(raw);
    if (!result) {
      return false;
    }

    const user = req.user as { role?: string } | undefined;
    if (!user?.role || !JWT_ROLES.has(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
