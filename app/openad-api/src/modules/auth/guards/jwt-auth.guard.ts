import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ESTRATEGIA_FEDERADA, ESTRATEGIA_INTERNA } from '../ecosystem-token';

/**
 * Autenticacao das rotas HTTP, nas duas origens de token possiveis.
 *
 * O passport tenta as estrategias em ordem e aceita a primeira que resolver um principal:
 * `jwt-internal` resolve o `sub` em `openad.users` (equipe da plataforma) e `jwt-federated`
 * resolve em `openad.ad_advertisers` (anunciante, com token emitido pelo hub). As duas
 * devolvem `null` em vez de lancar quando nao reconhecem o `sub`, que e o que permite a
 * segunda ser tentada.
 *
 * A ordem importa pouco para corretude, porque os dois espacos de identificador sao
 * disjuntos — `openad.users.userId` e gerado aqui, `public.users.id` no Postgres do hub —
 * mas a interna vem primeiro porque responde a maior parte do trafego (o portal).
 *
 * Os tablets **nao** passam por aqui: tem `DeviceJwtAuthGuard`, com `typ: 'device'` e
 * verificacao de impressao digital de hardware.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard([
  ESTRATEGIA_INTERNA,
  ESTRATEGIA_FEDERADA,
]) {}
