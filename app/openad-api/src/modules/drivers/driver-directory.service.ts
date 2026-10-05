import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';

/** O que o operador precisa ver para escolher um motorista. */
export interface MotoristaResumo {
  /** `public.users.id`. E o que vai para `vehicles.driverId` e para o repasse. */
  userId: string;
  name: string;
  /** Unico em `public.users`. E o identificador que o operador reconhece. */
  email: string;
}

/** Teto de resultados. Pesquisa de operador, nao exportacao. */
const LIMITE = 20;

/**
 * Consulta de motorista no espelho de identidade do ecossistema.
 *
 * Somente leitura, e isto nao e detalhe: `public.users` pertence ao hub, e a regra do
 * ecossistema (ver o cabecalho de `prisma/schema.prisma`) e que so o dono altera o seu
 * schema. O openad le as colunas que espelha e nada mais.
 *
 * Existe porque o vinculo de motorista era um UUID digitado a mao. `vehicles.driverId` e
 * validado apenas por `@IsUUID()` — qualquer UUID bem formado era aceito, e o unico lugar
 * onde ele e lido e o **crédito de repasse**. Um digito trocado mandava o dinheiro do
 * motorista para um identificador que nao existe, e a falha era silenciosa: o
 * `DriverEarningClient` nao lanca excecao, e o relatorio de conferencia conta a veiculacao
 * como atribuida. Dinheiro sumindo sem erro em lugar nenhum.
 *
 * O filtro por `role = 'Driver'` nao e autorizacao — papel do hub nao concede nada no
 * openad, pela mesma doutrina de `FederatedIdentityService`. Aqui ele e **predicado de
 * busca**: o operador esta procurando um motorista, nao um passageiro.
 */
@Injectable()
export class DriverDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(DriverDirectoryService.name);
  }

  /**
   * Motoristas cujo nome ou e-mail contem `termo`. Termo vazio devolve os primeiros,
   * ordenados por nome — e o estado inicial util da tela, nao uma busca em branco.
   */
  async pesquisar(termo: string): Promise<MotoristaResumo[]> {
    const q = termo.trim();

    const linhas = await this.prisma.user.findMany({
      where: {
        role: 'Driver',
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      take: LIMITE,
    });

    return linhas.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
    }));
  }

  /**
   * Devolve o motorista se, e somente se, o `userId` existir e tiver papel `Driver`.
   *
   * E a validacao que faltava no vinculo. `null` aqui significa "nao vincule": ou o
   * identificador nao existe, ou aponta para alguem que nao e motorista.
   */
  async resolver(userId: string): Promise<MotoristaResumo | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!u) {
      return null;
    }
    if (u.role !== 'Driver') {
      this.logger.warn(
        { event: 'motorista.papel_incorreto', userId, role: u.role },
        'identificador existe mas nao e de motorista'
      );
      return null;
    }
    return { userId: u.id, name: u.name, email: u.email };
  }

  /** Nome e e-mail de vários motoristas de uma vez, para listagem de aparelhos. */
  async resolverMuitos(
    userIds: readonly string[]
  ): Promise<Map<string, MotoristaResumo>> {
    const unicos = [...new Set(userIds.filter(Boolean))];
    if (unicos.length === 0) {
      return new Map();
    }
    const linhas = await this.prisma.user.findMany({
      where: { id: { in: unicos } },
      select: { id: true, name: true, email: true },
    });
    return new Map(
      linhas.map((u) => [
        u.id,
        { userId: u.id, name: u.name, email: u.email },
      ])
    );
  }
}
