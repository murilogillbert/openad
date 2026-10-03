import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';

export interface AnuncianteResolvido {
  /** `public.users.id` — e o que grava em `campaigns.ownerUserId` e `media_assets.ownerUserId`. */
  userId: string;
  email: string;
  advertiserId: string;
  legalName: string;
}

/**
 * Resolve um token do ecossistema para um anunciante do openad.
 *
 * **O papel nunca vem do token.** O `role` que o hub emite (`Passenger`, `Driver`,
 * `Partner`, `Admin`) descreve o que a pessoa e no hub, e nao concede nada aqui. O que
 * concede e existir linha ativa em `openad.ad_advertisers` para aquele `sub`. Autorizacao
 * apoiada em nome de papel seria apoiada em os dois servicos nunca escolherem o mesmo nome,
 * o que nao e garantia nenhuma.
 *
 * Anunciante `suspended` e tratado como ausente: deixa de autenticar na hora, sem esperar o
 * token expirar.
 */
@Injectable()
export class FederatedIdentityService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService
  ) {
    this.logger.setContext(FederatedIdentityService.name);
  }

  async resolverAnunciante(
    userIdDoEcossistema: string
  ): Promise<AnuncianteResolvido | null> {
    const anunciante = await this.prisma.adAdvertiser.findUnique({
      where: { userId: userIdDoEcossistema },
      select: {
        id: true,
        legalName: true,
        status: true,
        user: { select: { id: true, email: true } },
      },
    });

    if (!anunciante) {
      return null;
    }
    if (anunciante.status !== 'active') {
      this.logger.warn(
        { event: 'advertiser.suspended', advertiserId: anunciante.id },
        'token de anunciante suspenso recusado'
      );
      return null;
    }

    return {
      userId: anunciante.user.id,
      email: anunciante.user.email,
      advertiserId: anunciante.id,
      legalName: anunciante.legalName,
    };
  }
}
