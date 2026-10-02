import { Injectable } from '@nestjs/common';
import type { UserRole } from '@openad/domain';
import {
  isInternalRole,
  ownerFilterFor,
} from '../auth/access-scope';

/**
 * Escopo de acesso a midia.
 *
 * Era um stub que devolvia `true` incondicionalmente, com comentario admitindo isso
 * ("Extend with real campaign membership checks") — e que, pior, **nao era chamado por
 * ninguem**: estava declarado como provider em `MediaIngestionModule` e nenhum caminho o
 * consultava. Combinado com `GET /campaigns` sem filtro de dono, abrir a plataforma para
 * parceiros faria cada anunciante ver e baixar a midia dos outros.
 *
 * A regra vive em `auth/access-scope` como funcao pura, porque `campaigns` tambem precisa
 * dela e um servico injetavel criaria ciclo entre os modulos.
 */
@Injectable()
export class MediaScopeService {
  isInternal(role: UserRole | string | undefined): boolean {
    return isInternalRole(role);
  }

  /** Filtro de dono a aplicar na consulta de midia. */
  ownerFilter(params: {
    userId: string | null | undefined;
    role: UserRole | string | undefined;
  }): Record<string, unknown> {
    return ownerFilterFor(params);
  }
}
