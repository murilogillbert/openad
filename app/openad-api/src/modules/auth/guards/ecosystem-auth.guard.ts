import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ESTRATEGIA_ECOSSISTEMA } from '../ecosystem-token';

/**
 * Autentica uma conta do ecossistema sem exigir que ela ja seja anunciante no openad.
 *
 * Uso restrito a adesao (`POST /advertiser/onboarding`) e a consulta da propria situacao.
 * Qualquer outra rota de `/advertiser/*` deve usar `JwtAuthGuard`, que exige a linha em
 * `openad.ad_advertisers`.
 */
@Injectable()
export class EcosystemAuthGuard extends AuthGuard(ESTRATEGIA_ECOSSISTEMA) {}
