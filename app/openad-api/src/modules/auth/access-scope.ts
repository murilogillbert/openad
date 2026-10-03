import { INTERNAL_USER_ROLES, type UserRole } from '@openad/domain';

/**
 * Escopo de acesso por papel.
 *
 * Funcoes puras de proposito: a regra e consultada por `campaigns` e por `media-ingestion`,
 * e um servico injetavel aqui criaria ciclo entre os dois modulos — `CampaignsModule` ja
 * importa `MediaIngestionModule`.
 */

/** `true` quando o papel pertence a equipe interna da plataforma. */
export function isInternalRole(role: UserRole | string | undefined): boolean {
  if (role === undefined) {
    return false;
  }
  // A comparacao e alargada para `string` de proposito: o parametro aceita qualquer texto,
  // porque o papel pode chegar de um token, e um papel desconhecido tem de responder `false`
  // em vez de nao compilar.
  return (INTERNAL_USER_ROLES as readonly string[]).includes(role);
}

/**
 * Filtro de dono para consultas de campanha e midia.
 *
 * `{}` para equipe interna, `{ ownerUserId }` para anunciante. O filtro tem de entrar na
 * consulta, nao depois dela: escopar em memoria faz a primeira pagina de um parceiro vir
 * vazia porque foi preenchida com registros de outro e descartada.
 *
 * Anunciante sem `userId` recebe um filtro que nao casa com nada — negar e o comportamento
 * correto quando nao se sabe quem esta perguntando.
 */
export function ownerFilterFor(params: {
  userId: string | null | undefined;
  role: UserRole | string | undefined;
}): Record<string, unknown> {
  if (isInternalRole(params.role)) {
    return {};
  }
  return { ownerUserId: params.userId ?? '__sem_dono__' };
}

/** Papeis que podem decidir moderacao de criativo. */
export function canModerate(role: UserRole | string | undefined): boolean {
  return role === 'content_moderator' || role === 'super_admin';
}
