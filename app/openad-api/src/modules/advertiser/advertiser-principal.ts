import { ForbiddenException } from '@nestjs/common';
import type { PrincipalAnunciante } from '../auth/strategies/federated-jwt.strategy';

export type { PrincipalAnunciante };

/**
 * Extrai o anunciante da requisicao, recusando qualquer outra origem.
 *
 * As rotas de `/advertiser` sao exclusivas do principal federado, e o `RolesGuard` **nao**
 * basta para garantir isso: ele tem desvio incondicional para `super_admin`, de modo que um
 * administrador interno atravessa `@Roles('advertiser')` sem ser anunciante. Esta funcao e o
 * que fecha essa porta.
 *
 * Nao e zelo teorico. Um principal interno nao tem `advertiserId`, e seu `userId` e um
 * identificador de `openad.users`, nao de `public.users`. Uma campanha criada por ele aqui
 * nasceria com `ownerUserId` apontando para um espaco de identificador diferente: invisivel
 * para todo anunciante, orfa de parceiro, e indistinguivel de dado corrompido numa auditoria
 * de faturamento.
 *
 * Lanca em vez de devolver nulo porque nao existe caminho valido adiante sem isto.
 */
export function anuncianteDaRequisicao(req: {
  user?: unknown;
}): PrincipalAnunciante {
  const u = req.user as Partial<PrincipalAnunciante> | undefined;
  if (u?.role !== 'advertiser' || !u.userId || !u.advertiserId) {
    throw new ForbiddenException({
      error: {
        code: 'ADVERTISER_ONLY',
        message:
          'Esta rota e exclusiva de anunciante autenticado pela conta do ecossistema',
      },
    });
  }
  return {
    userId: u.userId,
    email: u.email ?? '',
    role: 'advertiser',
    advertiserId: u.advertiserId,
    legalName: u.legalName ?? '',
  };
}
