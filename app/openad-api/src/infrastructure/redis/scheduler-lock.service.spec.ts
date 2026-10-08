import { PinoLogger } from 'nestjs-pino';
import { RedisService } from './redis.service';
import { SchedulerLockService } from './scheduler-lock.service';

/**
 * Lock dos agendadores (item G.4 do plano v2).
 *
 * O que precisa de prova é **política**, não mecânica:
 *
 *   1. Redis fora do ar → **executa**. "Não consegui o lock" nunca pode significar "o Redis
 *      caiu", senão uma falha no Redis para a expiração de comandos, a vigilância de heartbeat
 *      e o ciclo de crédito de uma vez, em silêncio.
 *   2. Lock já tomado → **não executa**, e sem erro.
 *   3. Exceção na tarefa não propaga: `@Cron` com rejeição não tratada não reagenda nada, e o
 *      sintoma seria o agendador parar sem aviso.
 */

function montar(opts: { set?: () => Promise<unknown> } = {}) {
  const chamadas: unknown[][] = [];
  const set = opts.set ?? (async () => 'OK');
  const redis = {
    getClient: () => ({
      set: (...args: unknown[]) => {
        chamadas.push(args);
        return set();
      },
    }),
  } as unknown as RedisService;

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;

  return { svc: new SchedulerLockService(redis, logger), chamadas, logger };
}

const ambiente = { ...process.env };
afterEach(() => {
  process.env = { ...ambiente };
});

describe('SchedulerLockService.desligado', () => {
  it('OPENAD_JEST=1 desliga', () => {
    /**
     * Desligado **sempre** em teste: o ambiente de teste sobe o módulo de agendamento, e o cron
     * dispararia no meio de uma suíte de integração — tornando o resultado dependente de
     * quando o relógio virou.
     */
    process.env.OPENAD_JEST = '1';
    delete process.env.OPENAD_SCHEDULERS_DISABLED;
    expect(montar().svc.desligado).toBe(true);
  });

  it('OPENAD_SCHEDULERS_DISABLED=true desliga', () => {
    // Alternativa de infraestrutura ao lock: réplicas que só atendem HTTP.
    delete process.env.OPENAD_JEST;
    process.env.OPENAD_SCHEDULERS_DISABLED = 'true';
    expect(montar().svc.desligado).toBe(true);
  });

  it('so o literal "true" desliga', () => {
    // `Boolean('false')` é verdadeiro em JavaScript; comparar com o literal evita desligar o
    // agendador justamente quando alguém pediu para mantê-lo ligado.
    delete process.env.OPENAD_JEST;
    process.env.OPENAD_SCHEDULERS_DISABLED = 'false';
    expect(montar().svc.desligado).toBe(false);
  });

  it('sem as variaveis, ligado', () => {
    delete process.env.OPENAD_JEST;
    delete process.env.OPENAD_SCHEDULERS_DISABLED;
    expect(montar().svc.desligado).toBe(false);
  });
});

describe('SchedulerLockService.comLock', () => {
  beforeEach(() => {
    delete process.env.OPENAD_JEST;
    delete process.env.OPENAD_SCHEDULERS_DISABLED;
  });

  it('executa quando toma o lock, com NX e PX', async () => {
    const { svc, chamadas } = montar();
    const tarefa = jest.fn(async () => undefined);

    await svc.comLock('k', 25_000, tarefa);

    expect(tarefa).toHaveBeenCalledTimes(1);
    /**
     * `PX` com o TTL e `NX` são o que fazem o lock expirar sozinho e ser exclusivo. Sem `PX`,
     * uma instância que morra no meio deixa o agendador travado para sempre.
     */
    expect(chamadas[0]).toEqual(['k', expect.any(String), 'PX', 25_000, 'NX']);
  });

  it('nao executa quando o lock ja esta tomado', async () => {
    // `SET NX` devolve `null` quando a chave existe.
    const { svc } = montar({ set: async () => null });
    const tarefa = jest.fn(async () => undefined);

    await svc.comLock('k', 1_000, tarefa);

    expect(tarefa).not.toHaveBeenCalled();
  });

  it('Redis fora do ar: EXECUTA, e avisa', async () => {
    /**
     * A decisão central. O lock é economia, não correção: nenhuma das tarefas depende dele para
     * estar certa, e na dúvida trabalho duplicado é melhor que trabalho nenhum.
     */
    const { svc, logger } = montar({
      set: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const tarefa = jest.fn(async () => undefined);

    await svc.comLock('k', 1_000, tarefa);

    expect(tarefa).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agendador.lock_indisponivel' })
    );
  });

  it('nao executa nada quando os agendadores estao desligados', async () => {
    process.env.OPENAD_SCHEDULERS_DISABLED = 'true';
    const { svc, chamadas } = montar();
    const tarefa = jest.fn(async () => undefined);

    await svc.comLock('k', 1_000, tarefa);

    expect(tarefa).not.toHaveBeenCalled();
    // Nem pede o lock: desligado é desligado, e pedir gastaria uma ida ao Redis por cron.
    expect(chamadas).toHaveLength(0);
  });

  it('excecao na tarefa e registrada e NAO propaga', async () => {
    /**
     * `@Cron` com rejeição não tratada não reagenda nada — o sintoma seria o agendador parar sem
     * aviso, que é o pior modo de falha possível para uma varredura.
     */
    const { svc, logger } = montar();
    const tarefa = jest.fn(async () => {
      throw new Error('falhou no meio');
    });

    await expect(svc.comLock('k', 1_000, tarefa)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agendador.falhou', chave: 'k' })
    );
  });

  it('o valor do lock identifica a replica, nao so o PID', async () => {
    /**
     * Em contêiner o PID é quase sempre `1`, então PID sozinho não identifica réplica nenhuma —
     * e o valor do lock existe para ser legível num `redis-cli GET` durante um incidente.
     */
    process.env.HOSTNAME = 'api-abc123';
    const { svc, chamadas } = montar();
    await svc.comLock('k', 1_000, async () => undefined);
    expect(String(chamadas[0]![1])).toContain('api-abc123');
  });
});
