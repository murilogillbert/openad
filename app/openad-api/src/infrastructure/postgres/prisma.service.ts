import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Acesso ao Postgres compartilhado do ecossistema (identidade e dinheiro).
 *
 * **A conexao e preguicosa de proposito.** O `PrismaClient` so abre socket na primeira
 * consulta, e nao chamamos `$connect()` no boot: a maioria esmagadora da API vive no
 * MongoDB, e as 101 suites de teste nao deveriam exigir um Postgres de pe para rodar. Quem
 * nao consulta, nao conecta.
 *
 * O desligamento, ao contrario, e explicito: sem `$disconnect` o processo fica preso ao sair,
 * porque o pool mantem handles abertos.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
