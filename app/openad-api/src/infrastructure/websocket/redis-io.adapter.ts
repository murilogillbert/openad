import { createAdapter } from '@socket.io/redis-adapter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO com adapter de Redis, para o painel receber evento emitido em **qualquer** réplica.
 *
 * ============================================================================
 * O problema (item G.3 do plano v2)
 * ============================================================================
 *
 * Com o `IoAdapter` padrão, `server.emit(...)` entrega **somente** aos clientes conectados
 * naquele processo. Com duas instâncias de API atrás de um balanceador, o operador conectado na
 * instância A não vê o evento emitido pela instância B — e o sintoma é "o painel não atualiza",
 * intermitente e dependente de em qual instância o navegador caiu.
 *
 * Isso atinge coisa que importa: mudança de estado de aparelho
 * (`FleetGateway.emitDeviceStateChanged`), aviso de aparelho offline da varredura de heartbeat,
 * e o pedido de atualizar o mapa da frota.
 *
 * ============================================================================
 * Por que dois clientes Redis
 * ============================================================================
 *
 * O protocolo pub/sub do Redis exige isso: uma conexão em modo `subscribe` não aceita outros
 * comandos. O adapter publica num cliente e escuta no outro — `duplicate()` é a forma canônica
 * de obter o segundo com a mesma configuração.
 *
 * Os dois são **novos**, e não o `RedisService` já existente: aquele é usado para `SET`, `GET` e
 * Redis Streams (consumo de impressões). Pôr uma das conexões em modo `subscribe` quebraria
 * todo o resto que a compartilha.
 *
 * ============================================================================
 * Sem `REDIS_URL`, cai no adapter padrão
 * ============================================================================
 *
 * E isso é correto, não um atalho. Uma instância só funciona perfeitamente com o adapter
 * padrão, e é assim que os testes e o desenvolvimento local rodam. Derrubar o boot por falta de
 * Redis aqui trocaria "painel pode perder evento se houver duas instâncias" por "a API não
 * sobe" — estritamente pior.
 *
 * O que não pode acontecer em silêncio é rodar **duas** instâncias sem o adapter; daí o log
 * explícito nos dois caminhos.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private readonly conexoes: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly aviso: (mensagem: string) => void
  ) {
    super(app);
  }

  /**
   * Liga o adapter. Devolve `false` quando não havia `REDIS_URL` — quem chama decide o que
   * registrar.
   */
  async conectar(): Promise<boolean> {
    const url = (process.env.REDIS_URL ?? '').trim();
    if (!url) {
      this.aviso(
        'Socket.IO sem adapter de Redis (REDIS_URL ausente): com mais de uma instancia da API, o painel perde eventos emitidos pelas outras.'
      );
      return false;
    }

    const pub = new Redis(url, {
      /**
       * `maxRetriesPerRequest: null` é exigência do uso em pub/sub: com o padrão, um comando
       * pendente durante uma reconexão é rejeitado, e o `ioredis` emite `unhandledRejection`
       * dentro do adapter — que não tem onde tratar.
       */
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    const sub = pub.duplicate();

    /**
     * Handler de erro nos dois, antes de qualquer uso.
     *
     * `Redis` é um `EventEmitter`: sem ouvinte de `error`, uma queda de conexão vira exceção não
     * tratada e **derruba o processo**. Aqui a queda tem de ser só um log — o `ioredis`
     * reconecta sozinho, e enquanto isso o Socket.IO continua entregando dentro da instância.
     */
    for (const c of [pub, sub]) {
      c.on('error', (e: Error) => {
        this.aviso(`Adapter de Redis do Socket.IO: ${e.message}`);
      });
      this.conexoes.push(c);
    }

    this.adapterConstructor = createAdapter(pub, sub, { key: 'openad:socket.io' });
    return true;
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (c: ReturnType<typeof createAdapter>) => void;
    };
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  /** Fecha as conexões no encerramento, para o `SIGTERM` não deixar socket pendurado. */
  async fechar(): Promise<void> {
    await Promise.allSettled(this.conexoes.map((c) => c.quit()));
  }
}
