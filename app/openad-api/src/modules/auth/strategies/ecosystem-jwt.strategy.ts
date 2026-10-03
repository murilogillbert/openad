import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../infrastructure/postgres/prisma.service';
import {
  ECOSSISTEMA_AUDIENCE,
  ECOSSISTEMA_ISSUER,
  ESTRATEGIA_ECOSSISTEMA,
  type PayloadDoEcossistema,
} from '../ecosystem-token';

/**
 * Conta do ecossistema, resolvida em `public.users`, **sem** exigir adesao ao openad.
 *
 * `advertiserId` e deliberadamente ausente deste principal: `anuncianteDaRequisicao` recusa
 * qualquer principal sem ele, de modo que um token validado por esta estrategia nao alcanca
 * nenhuma rota de `/advertiser/*` por acidente, mesmo se alguem trocar o guard de lugar.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PrincipalDoEcossistema {
  /** `public.users.id`. */
  userId: string;
  email: string;
  name: string;
  /** Papel **no hub** (`Passenger`, `Driver`, ...). Nao concede nada aqui. */
  hubRole: string;
}

/**
 * Valida token emitido por outro servico do ecossistema e resolve a conta em `public.users`.
 *
 * Usada **somente** pela adesao do anunciante. A diferenca em relacao a `jwt-federated` e uma
 * so, e e o ponto todo: aqui a existencia de linha em `openad.ad_advertisers` nao e requisito.
 *
 * `issuer`, `audience` e `algorithms` sao exigidos, como na federada: todo token do hub os
 * tem, e fixar o algoritmo fecha a troca de HS256 por outro esquema.
 *
 * Resolver em `public.users` nao e formalidade. O `sub` vem assinado com um segredo
 * compartilhado por tres servicos; sem a consulta, um token com `sub` arbitrario — de um
 * usuario removido, por exemplo — criaria uma linha de anunciante apontando para conta
 * inexistente, e a FK `onDelete: Restrict` nem chegaria a ser consultada porque o `INSERT`
 * falharia depois, no meio da requisicao.
 */
@Injectable()
export class EcosystemJwtStrategy extends PassportStrategy(
  Strategy,
  ESTRATEGIA_ECOSSISTEMA
) {
  constructor(private readonly prisma: PrismaService) {
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
  ): Promise<PrincipalDoEcossistema | null> {
    if (!payload?.sub || !UUID.test(payload.sub)) {
      /**
       * A verificacao de formato vem antes da consulta porque `public.users.id` e `@db.Uuid`:
       * o Prisma recusa um valor fora do formato com erro de tipo, que subiria como 500. O
       * `sub` de um token interno do openad e um UUID tambem, mas de outro espaco de
       * identificador — ele simplesmente nao sera encontrado, que e o resultado correto.
       */
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) {
      return null;
    }
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      hubRole: String(user.role),
    };
  }
}
