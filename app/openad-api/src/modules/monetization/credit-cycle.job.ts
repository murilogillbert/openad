import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { SchedulerLockService } from '../../infrastructure/redis/scheduler-lock.service';
import { CreditCycleService } from './credit-cycle.service';

/**
 * Abre e fecha as reservas de crédito a cada ciclo.
 *
 * ============================================================================
 * Por que existe um lock, se o `cycleId` já é determinístico
 * ============================================================================
 *
 * O `cycleId` e o índice único `(campaignId, cycleId)` já garantem **correção**: duas
 * instâncias abrindo o ciclo ao mesmo tempo produzem as mesmas reservas, não o dobro. O lock
 * não está aqui para corrigir, está para evitar **trabalho e contenção**: sem ele, cada réplica
 * percorreria todos os anunciantes, pegaria `FOR UPDATE` na linha de cada um e descobriria no
 * fim que a outra já tinha reservado. Com frota e base grandes, isso é um pico de lock a cada
 * 15 minutos, por réplica.
 *
 * O mecanismo vive em `SchedulerLockService`, compartilhado com os outros cinco `@Cron` do
 * projeto (item G.4 do plano v2). A cópia local que existia aqui foi a primeira aplicação do
 * padrão; mantê-la em paralelo deixaria duas políticas de "Redis fora do ar" para manter em
 * sincronia, e elas têm de ser a mesma.
 */
@Injectable()
export class CreditCycleJob {
  /** Vale menos que o ciclo, para o ciclo seguinte nunca topar com o lock do anterior. */
  private static readonly LOCK_TTL_MS = 4 * 60_000;

  constructor(
    private readonly ciclo: CreditCycleService,
    private readonly lock: SchedulerLockService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CreditCycleJob.name);
  }

  /**
   * A cada 5 minutos, e não a cada 15.
   *
   * O ciclo dura 15 minutos, mas rodar exatamente nessa cadência deixaria o início do ciclo
   * descoberto quando uma execução falhasse: a próxima tentativa só viria 15 minutos depois, e
   * nesse intervalo nenhuma campanha teria reserva — a frota inteira ficaria sem anúncio
   * faturável. Rodando a cada 5 minutos, uma falha é recuperada dentro do mesmo ciclo.
   *
   * Reexecutar dentro do mesmo ciclo é inofensivo: a campanha que já tem reserva é pulada.
   */
  @Cron('0 */5 * * * *')
  async abrir(): Promise<void> {
    await this.lock.comLock(
      'openad:credito:abrir-ciclo',
      CreditCycleJob.LOCK_TTL_MS,
      async () => {
        const r = await this.ciclo.abrirCiclo();
        this.logger.info({ event: 'credito.job.abertura', ...r });
      }
    );
  }

  /**
   * Fecha o que venceu, devolvendo ao saldo o que não foi capturado.
   *
   * Separado da abertura de propósito: se o fechamento falhar, a abertura do ciclo seguinte
   * ainda acontece. Juntos no mesmo método, uma exceção no fechamento impediria a abertura, e o
   * efeito visível seria "nenhum anúncio no ar" — um sintoma que não aponta para a causa.
   */
  @Cron('30 */5 * * * *')
  async fechar(): Promise<void> {
    await this.lock.comLock(
      'openad:credito:fechar-ciclo',
      CreditCycleJob.LOCK_TTL_MS,
      async () => {
        const r = await this.ciclo.fecharCiclosVencidos();
        if (r.fechadas > 0) {
          this.logger.info({ event: 'credito.job.fechamento', ...r });
        }
      }
    );
  }
}
