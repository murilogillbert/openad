import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from './redis.service';

/**
 * Lock curto para `@Cron`, para que um agendador rode em **uma** instância por vez.
 *
 * ============================================================================
 * O problema (item G.4 do plano v2)
 * ============================================================================
 *
 * Toda tarefa `@Cron` do projeto roda em **toda** réplica da API, sem lock nem eleição de
 * líder. Com uma instância isso não aparece; com duas, cada varredura acontece em dobro:
 * `heartbeat-monitor` lê a frota inteira duas vezes a cada 30 s, as limpezas apagam duas vezes,
 * e a revalidação de mídia reprocessa o mesmo acervo.
 *
 * ============================================================================
 * Por que `SET … NX PX`, e não eleição de líder
 * ============================================================================
 *
 * Porque expira sozinho. Uma instância que morra no meio da tarefa não deixa o agendador
 * travado para sempre — que é exatamente o que uma eleição de líder mal supervisionada produz.
 * E não há dependência nova: o `ioredis` já está no projeto.
 *
 * O lock **não** é liberado no fim, de propósito: ele expira. Liberar explicitamente abre a
 * janela clássica — a instância termina, libera, e uma execução atrasada do cron entra de novo
 * na mesma janela. Deixar expirar é mais simples e tem o mesmo efeito, porque reexecutar é
 * inofensivo em todas as tarefas que usam isto.
 *
 * ============================================================================
 * Redis fora do ar: **executa**
 * ============================================================================
 *
 * É a decisão que importa aqui, e ela é deliberada. "Não consegui o lock" tem de significar
 * "outra instância está cuidando", nunca "o Redis caiu" — do contrário uma falha no Redis
 * pararia a expiração de comandos, a vigilância de heartbeat e o ciclo de crédito, todos de uma
 * vez e em silêncio.
 *
 * O lock é **economia, não correção**: nenhuma destas tarefas depende dele para estar certa.
 * Na dúvida, trabalho duplicado é melhor que trabalho nenhum.
 */
@Injectable()
export class SchedulerLockService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(SchedulerLockService.name);
  }

  /**
   * `true` quando os agendadores estão desligados nesta instância.
   *
   * Duas formas, com motivos diferentes:
   *
   * - `OPENAD_SCHEDULERS_DISABLED=true` permite subir réplicas que só atendem HTTP, o que é a
   *   alternativa de infraestrutura ao lock (item G.4: "uma flag de ambiente que liga os
   *   agendadores em uma instância só").
   * - `OPENAD_JEST=1` desliga **sempre** em teste. O ambiente de teste sobe o módulo de
   *   agendamento, então o cron dispararia no meio de uma suíte de integração — e o resultado
   *   passaria a depender de quando o relógio virou. Quem testa a tarefa a chama diretamente.
   */
  get desligado(): boolean {
    return (
      process.env.OPENAD_SCHEDULERS_DISABLED === 'true' || process.env.OPENAD_JEST === '1'
    );
  }

  /**
   * Executa `tarefa` se conseguir o lock (ou se o Redis não responder).
   *
   * `ttlMs` deve ser **menor** que o intervalo do cron, para a execução seguinte nunca topar com
   * o lock da anterior. Para uma tarefa a cada 30 s, algo como 25 s; para uma diária, minutos
   * bastam — o que se quer evitar é a sobreposição entre réplicas, não entre horas.
   *
   * Exceção na tarefa é registrada e **não** propaga: `@Cron` sem `try` derruba a execução com
   * `unhandledRejection`, e o Nest não reagenda nada por isso — o sintoma seria o agendador
   * parar sem aviso.
   */
  async comLock(chave: string, ttlMs: number, tarefa: () => Promise<void>): Promise<void> {
    if (this.desligado) return;

    let obtido = false;
    try {
      const r = await this.redis.getClient().set(chave, this.identidade(), 'PX', ttlMs, 'NX');
      obtido = r === 'OK';
    } catch (e: unknown) {
      this.logger.warn({
        event: 'agendador.lock_indisponivel',
        chave,
        err: e instanceof Error ? e.message : String(e),
      });
      // Ver a nota do cabeçalho: na dúvida, executa.
      obtido = true;
    }

    if (!obtido) return;

    try {
      await tarefa();
    } catch (e: unknown) {
      this.logger.error({
        event: 'agendador.falhou',
        chave,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Quem tomou o lock, para o valor ser legível em `redis-cli GET`.
   *
   * `hostname` e não só `process.pid`: em contêiner o PID costuma ser o mesmo entre réplicas
   * (quase sempre 1), então PID sozinho não identifica nada. É o mesmo motivo do nome de
   * consumidor do Redis Streams — ver `impression-stream.consumer.ts`.
   */
  private identidade(): string {
    return `${process.env.HOSTNAME ?? 'local'}:${process.pid}`;
  }
}
