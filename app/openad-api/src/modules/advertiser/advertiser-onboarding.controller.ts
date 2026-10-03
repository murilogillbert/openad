import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EcosystemAuthGuard } from '../auth/guards/ecosystem-auth.guard';
import type { PrincipalDoEcossistema } from '../auth/strategies/ecosystem-jwt.strategy';
import { AdvertiserOnboardingService } from './advertiser-onboarding.service';
import { AderirAnuncianteDto } from './dto/aderir-anunciante.dto';

/**
 * Adesao da conta do ecossistema ao openad como anunciante.
 *
 * Controlador separado do `AdvertiserController` por necessidade, nao por organizacao: aquele
 * usa `JwtAuthGuard`, que exige linha em `openad.ad_advertisers`. Estas duas rotas sao as
 * unicas que podem ser alcancadas **antes** de a linha existir, e por isso usam
 * `EcosystemAuthGuard`.
 *
 * Nenhuma rota de dado de campanha deve viver aqui. O principal resolvido por
 * `jwt-ecosystem` nao tem `advertiserId`, e `anuncianteDaRequisicao` o recusaria — mas a
 * separacao fisica e o que torna o erro impossivel em vez de improvavel.
 */
@ApiTags('advertiser')
@ApiBearerAuth()
@Controller('advertiser/onboarding')
@UseGuards(EcosystemAuthGuard)
export class AdvertiserOnboardingController {
  constructor(private readonly adesao: AdvertiserOnboardingService) {}

  @Get()
  @ApiOperation({
    summary: 'Diz se esta conta do ecossistema ja e anunciante no openad',
  })
  async situacao(@Req() req: Request) {
    const p = contaDoEcossistema(req);
    const anunciante = await this.adesao.situacao(p.userId);
    return {
      conta: { userId: p.userId, email: p.email, name: p.name },
      anunciante,
      /** O app usa isto para decidir entre a tela de adesao e a lista de campanhas. */
      precisaAderir: anunciante === null,
    };
  }

  /**
   * O codigo e 200, nao 201, mesmo quando cria.
   *
   * A rota e idempotente e a resposta carrega `criado` dizendo o que aconteceu. Devolver 201
   * na primeira chamada e 200 nas seguintes obrigaria o cliente a tratar dois codigos de
   * sucesso para o mesmo resultado desejado ("sou anunciante agora"), e e justamente o
   * cliente que nao sabe se uma tentativa anterior gravou.
   */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Torna esta conta do ecossistema um anunciante ativo' })
  async aderir(@Body() dto: AderirAnuncianteDto, @Req() req: Request) {
    return this.adesao.aderir(contaDoEcossistema(req), dto.legalName);
  }
}

/**
 * Extrai a conta do ecossistema, recusando qualquer outra origem de principal.
 *
 * A guarda `EcosystemAuthGuard` ja garante isso hoje. A verificacao redundante existe porque
 * o custo de errar aqui e alto e silencioso: um principal interno (`openad.users`) tem
 * `userId` de **outro** espaco de identificador, e usa-lo criaria linha em `ad_advertisers`
 * com `user_id` que nao existe em `public.users` — ou falharia na FK no meio da requisicao,
 * ou, se a FK fosse afrouxada algum dia, criaria parceiro fantasma em relatorio de
 * faturamento.
 */
function contaDoEcossistema(req: Request): PrincipalDoEcossistema {
  const u = req.user as Partial<PrincipalDoEcossistema> | undefined;
  if (!u?.userId || typeof u.name !== 'string') {
    throw new ForbiddenException({
      error: {
        code: 'ECOSYSTEM_ACCOUNT_REQUIRED',
        message:
          'Esta rota exige autenticacao com a conta do ecossistema OpenDriver',
      },
    });
  }
  return {
    userId: u.userId,
    email: u.email ?? '',
    name: u.name,
    hubRole: u.hubRole ?? '',
  };
}
