import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';

export const ESCOPOS_DE_CHAVE = 'escopos_de_chave';

/**
 * Escopos exigidos de uma chave de serviço.
 *
 * Exige **todos** os listados, não qualquer um — mesma semântica do `requireApiKey` do hub e
 * do opendriver (`scopes.every(...)`). Chave com escopo de leitura não executa purga por
 * acidente.
 */
export const EscoposDeChave = (...escopos: string[]) =>
  SetMetadata(ESCOPOS_DE_CHAVE, escopos);

/** Principal de uma chamada servico-a-servico. Não é usuário: não tem papel nem sessão. */
export interface PrincipalDeServico {
  apiKeyId: string;
  label: string;
  scopes: string[];
}

/**
 * Autenticação servico-a-servico por `public.service_api_keys`.
 *
 * Reimplementa deliberadamente o mesmo contrato do hub
 * (`hub/backend/src/infra/auth/apiKey.ts`) e do opendriver
 * (`opendriver/backend/src/middleware/apiKey.ts`): `Authorization: Bearer <chave>`, hash
 * **SHA-256 em hexadecimal sem sal**, busca por igualdade em `hashed_key`, recusa se
 * `active = false`, e verificação de escopo por conjunção.
 *
 * O hash sem sal não é descuido: é o que permite `findUnique` por índice em vez de varredura
 * comparando uma a uma. A chave tem 32 bytes de entropia (`crypto.randomBytes(32)`), então
 * não há dicionário a atacar — o risco que um sal mitigaria, de senha fraca e reusada, não
 * existe aqui.
 *
 * **O openad nunca escreve nesta tabela.** Quem emite, revoga e atualiza `last_used_at` é o
 * hub, em Admin → Chaves de API. Daí o espelho ser somente leitura no `schema.prisma`.
 */
@Injectable()
export class ServiceApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ServiceApiKeyGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const exigidos =
      this.reflector.getAllAndOverride<string[]>(ESCOPOS_DE_CHAVE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const chave = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!chave) {
      throw new UnauthorizedException({
        error: { code: 'API_KEY_MISSING', message: 'Chave de API ausente' },
      });
    }

    const hash = createHash('sha256').update(chave).digest('hex');
    const linha = await this.prisma.serviceApiKey.findUnique({
      where: { hashedKey: hash },
      select: { id: true, label: true, scopes: true, active: true },
    });

    if (!linha || !linha.active) {
      /**
       * Log sem a chave e sem o hash.
       *
       * Gravar o hash num log permitiria a quem lê o log testar chaves candidatas offline
       * contra ele. O `keyPreview` existe exatamente para identificar a chave em trilha de
       * auditoria, e é o hub que o guarda.
       */
      this.logger.warn(
        { event: 'internal.apikey.rejeitada', motivo: linha ? 'inativa' : 'desconhecida' },
        'chave de servico recusada'
      );
      throw new UnauthorizedException({
        error: { code: 'API_KEY_INVALID', message: 'Chave de API invalida' },
      });
    }

    const faltando = exigidos.filter((e) => !linha.scopes.includes(e));
    if (faltando.length > 0) {
      this.logger.warn(
        {
          event: 'internal.apikey.sem_escopo',
          apiKeyId: linha.id,
          faltando,
        },
        'chave de servico sem escopo'
      );
      throw new ForbiddenException({
        error: {
          code: 'API_KEY_SCOPE',
          message: `Chave sem os escopos: ${faltando.join(', ')}`,
        },
      });
    }

    (req as Request & { servico?: PrincipalDeServico }).servico = {
      apiKeyId: linha.id,
      label: linha.label,
      scopes: linha.scopes,
    };
    return true;
  }
}
