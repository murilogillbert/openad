/**
 * Constantes do token compartilhado do ecossistema OpenDriver.
 *
 * Os tres servicos — `hub`, `opendriver` e `openad` — assinam HS256 com o **mesmo**
 * `JWT_SECRET` e com estes `issuer` e `audience`, de modo que um token emitido por um vale
 * nos outros. Os valores sao constantes no hub
 * (`hub/backend/src/config.ts`, `issuer: 'opendriverhub'`, `audience: 'opendriverhub'`) e no
 * opendriver; nao vem de variavel de ambiente em nenhum dos tres.
 */
export const ECOSSISTEMA_ISSUER = 'opendriverhub';
export const ECOSSISTEMA_AUDIENCE = 'opendriverhub';

/** Nome da estrategia passport que valida token emitido por este servico. */
export const ESTRATEGIA_INTERNA = 'jwt-internal';

/** Nome da estrategia passport que valida token emitido por outro servico do ecossistema. */
export const ESTRATEGIA_FEDERADA = 'jwt-federated';

/**
 * Estrategia que valida token do ecossistema **sem** exigir que a conta ja seja anunciante.
 *
 * Existe porque `jwt-federated` resolve o `sub` em `openad.ad_advertisers` e devolve `null`
 * quando nao acha — o que significa 401 para quem ainda nao aderiu. Sem uma estrategia que
 * autentique antes da adesao, nao haveria como aderir: a unica rota capaz de criar a linha
 * exigiria a linha que ela cria.
 *
 * O principal que ela resolve e o usuario do hub (`public.users`), e so a adesao
 * (`/advertiser/onboarding`) a usa. Nenhuma rota de dado de campanha deve aceita-la.
 */
export const ESTRATEGIA_ECOSSISTEMA = 'jwt-ecosystem';

/**
 * Payload que o **hub** emite (`hub/backend/src/infra/auth/jwt.ts`, `AccessTokenClaims`).
 *
 * `role` aqui e papel do hub (`Passenger`, `Driver`, `Partner`, `Admin`, ...), **nao** papel
 * do openad. Ele e deliberadamente ignorado na autorizacao: ver `FederatedIdentityService`.
 */
export interface PayloadDoEcossistema {
  sub: string;
  name?: string;
  email?: string;
  role?: string;
  partnerId?: string;
  iss?: string;
  aud?: string;
}
