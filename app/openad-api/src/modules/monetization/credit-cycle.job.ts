import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from '../../infrastructure/redis/redis.service';
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
 * `SET … NX PX` no Redis é o lock mais simples que serve: expira sozinho, então uma instância
 * que morra no meio não deixa o ciclo travado para sempre. A janela de expiração é menor que o
 * ciclo, para o ciclo seguinte nunca encontrar o lock do anterior.
 *
 * Isto é o item G.4 do plano aplicado onde ele mais importa — o único agendador que mexe em
 * dinheiro. Os outros cinco `@Cron` do projeto continuam rodando em toda instância; a flag
 * `OPENAD_SCHEDULERS_DISABLED` permite desligar este aqui por completo numa réplica.
 */
@Injectable()
export class CreditCycleJob {
  /** Vale menos que o ciclo, para o ciclo seguinte nunca topar com o lock do anterior. */
  private static readonly LOCK_TTL_MS = 4 * 60_000;

  constructor(
    private readonly ciclo: CreditCycleService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CreditCycleJob.name);
  }

  /**
   * Desligado por configuração, e **sempre** sob teste.
   *
   * O ambiente de teste sobe o módulo de agendamento, então o cron dispararia durante as
   * suítes de integração — abrindo reservas no meio de um caso que acabou de semear uma
   * campanha, e tornando o resultado dependente de quando o relógio virou. Os testes que
   * precisam do ciclo o chamam diretamente, que é o padrão que este projeto já usa com o
   * processador de analytics.
   */
  private get desligado(): boolean {
    return (
      process.env.OPENAD_SCHEDULERS_DISABLED === 'true' || process.env.OPENAD_JEST === '1'
    );
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
    if (this.desligado) return;
    await this.comLock('openad:credito:abrir-ciclo', async () => {
      const r = await this.ciclo.abrirCiclo();
      this.logger.info({ event: 'credito.job.abertura', ...r });
    });
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
    if (this.desligado) return;
    await this.comLock('openad:credito:fechar-ciclo', async () => {
      const r = await this.ciclo.fecharCiclosVencidos();
      if (r.fechadas > 0) {
        this.logger.info({ event: 'credito.job.fechamento', ...r });
      }
    });
  }

  /**
   * Executa com lock de curta duração. Não faz nada se outra instância já está executando.
   *
   * O lock **não** é liberado no fim de propósito: ele expira. Liberar explicitamente abriria a
   * janela clássica — a instância termina, libera, e a próxima execução do cron (que pode estar
   * atrasada) entra de novo no mesmo ciclo. Deixar expirar é mais simples e tem o mesmo efeito,
   * porque reexecutar é inofensivo de qualquer forma.
   */
  private async comLock(chave: string, tarefa: () => Promise<void>): Promise<void> {
    let obtido = false;
    try {
      const r = await this.redis
        .getClient()
        .set(chave, String(process.pid), 'PX', CreditCycleJob.LOCK_TTL_MS, 'NX');
      obtido = r === 'OK';
    } catch (e: unknown) {
      /**
       * Redis fora do ar não pode parar o ciclo de crédito.
       *
       * Sem reserva, nenhuma campanha veicula — então "não consegui o lock" tem de significar
       * "outra instância está cuidando", e não "o Redis caiu". Na dúvida, executa: a correção
       * não depende do lock, só a economia de trabalho.
       */
      this.logger.warn({
        event: 'credito.job.lock_indisponivel',
        chave,
        err: e instanceof Error ? e.message : String(e),
      });
      obtido = true;
    }

    if (!obtido) return;

    try {
      await tarefa();
    } catch (e: unknown) {
      this.logger.error({
        event: 'credito.job.falhou',
        chave,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
