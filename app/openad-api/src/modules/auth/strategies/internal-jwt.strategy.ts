import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { InternalUserRole } from '@openad/domain';
import type { JwtAccessPayload } from '../auth.service';
import { ESTRATEGIA_INTERNA } from '../ecosystem-token';
import { UsersService } from '../users.service';

export interface PrincipalInterno {
  userId: string;
  email: string;
  role: InternalUserRole;
  sid?: string;
  /** Sempre `null` para equipe interna; existe para o consumidor nao precisar diferenciar. */
  advertiserId: null;
}

/**
 * Token emitido por **este** servico, para a equipe interna de `openad.users`.
 *
 * O papel vem do **banco**, nao do token. Essa troca e de seguranca, e e a correcao de um
 * furo real: o `JWT_SECRET` e compartilhado com o hub e o opendriver, e a versao anterior
 * copiava `payload.role` direto para `req.user` sem consultar nada. O que impedia um usuario
 * do hub de virar administrador do openad era apenas os conjuntos de papeis nao se cruzarem
 * por acaso (`Admin` no hub, `super_admin` aqui) — e o `RolesGuard` tem desvio incondicional
 * para `super_admin`. No dia em que o hub criasse um papel com esse nome, qualquer usuario
 * dele teria acesso total aqui. Resolvendo o `sub` em `openad.users`, um token de outro
 * servico simplesmente nao encontra usuario e e recusado.
 *
 * Efeito colateral desejado: trocar o papel de alguem passa a valer na hora, sem esperar o
 * token expirar.
 *
 * `issuer` e `audience` **nao** sao exigidos aqui de proposito. O openad passou a assinar com
 * os dois, mas os tokens ja emitidos nao os tem e o refresh dura 30 dias; exigir agora
 * invalidaria todas as sessoes vivas. A verificacao pode ser ligada depois que a janela do
 * refresh tiver passado — e ela nao e o que protege a fronteira, o banco e.
 */
@Injectable()
export class InternalJwtStrategy extends PassportStrategy(
  Strategy,
  ESTRATEGIA_INTERNA
) {
  constructor(private readonly users: UsersService) {
    const secret = (process.env.JWT_SECRET ?? '').trim();
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Devolve `null` em vez de lancar quando o `sub` nao e de um usuario interno: e isso que
   * faz o passport seguir para a estrategia federada, no guard que combina as duas.
   */
  async validate(payload: JwtAccessPayload): Promise<PrincipalInterno | null> {
    if (!payload?.sub) {
      return null;
    }
    const user = await this.users.findByUserId(payload.sub);
    if (!user) {
      return null;
    }
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      sid: payload.sid,
      advertiserId: null,
    };
  }
}
