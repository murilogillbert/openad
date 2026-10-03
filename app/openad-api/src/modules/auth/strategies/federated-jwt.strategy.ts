import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { FederatedUserRole } from '@openad/domain';
import {
  ECOSSISTEMA_AUDIENCE,
  ECOSSISTEMA_ISSUER,
  ESTRATEGIA_FEDERADA,
  type PayloadDoEcossistema,
} from '../ecosystem-token';
import { FederatedIdentityService } from '../federated-identity.service';

export interface PrincipalAnunciante {
  /** `public.users.id`. */
  userId: string;
  email: string;
  role: FederatedUserRole;
  advertiserId: string;
  legalName: string;
}

/**
 * Token emitido por **outro** servico do ecossistema (hoje, o hub), para o anunciante.
 *
 * Aqui `issuer`, `audience` e `algorithms` **sao** exigidos: todo token do hub os tem, e
 * fixar o algoritmo fecha a troca de HS256 por outro esquema.
 *
 * O papel devolvido e a constante `'advertiser'`, nunca o `role` do payload — ver
 * `FederatedIdentityService`. A permissao vem da linha em `openad.ad_advertisers`.
 */
@Injectable()
export class FederatedJwtStrategy extends PassportStrategy(
  Strategy,
  ESTRATEGIA_FEDERADA
) {
  constructor(private readonly identidade: FederatedIdentityService) {
    const secret = (process.env.JWT_SECRET ?? '').trim();
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: ECOSSISTEMA_ISSUER,
      audience: ECOSSISTEMA_AUDIENCE,
      algorithms: ['HS256'],
    });
  }

  async validate(
    payload: PayloadDoEcossistema
  ): Promise<PrincipalAnunciante | null> {
    if (!payload?.sub) {
      return null;
    }
    const anunciante = await this.identidade.resolverAnunciante(payload.sub);
    if (!anunciante) {
      return null;
    }
    return {
      userId: anunciante.userId,
      email: anunciante.email,
      role: 'advertiser',
      advertiserId: anunciante.advertiserId,
      legalName: anunciante.legalName,
    };
  }
}
