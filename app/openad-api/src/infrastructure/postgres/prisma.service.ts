import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Teto para o desligamento do pool. Ver a nota em `onModuleDestroy`. */
const TETO_DE_DESCONEXAO_MS = 2_000;

/**
 * Acesso ao Postgres compartilhado do ecossistema (identidade e dinheiro).
 *
 * **A conexao e preguicosa de proposito.** O `PrismaClient` so abre socket na primeira
 * consulta, e nao chamamos `$connect()` no boot: a maioria esmagadora da API vive no
 * MongoDB, e as 101 suites de teste nao deveriam exigir um Postgres de pe para rodar. Quem
 * nao consulta, nao conecta.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Desligamento com teto de tempo.
   *
   * Sem `$disconnect` o processo fica preso ao sair, porque o pool mantem handles abertos.
   * Mas com a conexao preguicosa existe o caso em que o cliente **nunca** conectou — tipico
   * em teste, onde `DATABASE_URL` aponta para um endereco que nao responde — e aí o
   * `$disconnect` pode ficar esperando um handshake que nao vai acontecer. Desligamento nao
   * pode bloquear: no pior caso o processo esta terminando mesmo, e o sistema operacional
   * fecha o socket.
   */
  async onModuleDestroy(): Promise<void> {
    let aTempo = false;
    await Promise.race([
      this.$disconnect().then(() => {
        aTempo = true;
      }),
      new Promise<void>((resolver) =>
        setTimeout(resolver, TETO_DE_DESCONEXAO_MS)
      ),
    ]);
    if (!aTempo) {
      this.logger.warn(
        `Postgres nao desconectou em ${TETO_DE_DESCONEXAO_MS}ms; seguindo com o desligamento`
      );
    }
  }
}
