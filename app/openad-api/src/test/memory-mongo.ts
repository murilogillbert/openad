import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

let memoryServer: MongoMemoryServer | null = null;

const MONGO_URI_CACHE_PATH = path.join(process.cwd(), '.cache', 'openad', 'mongo-test-uri.txt');

/**
 * O padrao de `mongodb-memory-server` e 10s, e ele nao e configuravel por variavel de
 * ambiente. Em maquina fria isso derruba a suite inteira no `globalSetup`, antes de qualquer
 * teste rodar: na primeira execucao o binario ainda esta sendo baixado e, mesmo depois,
 * medimos 7s so na criacao do storage engine do WiredTiger. O custo de um teto mais alto e
 * zero quando a instancia sobe rapido, porque o timer e cancelado na hora.
 */
const MONGOD_LAUNCH_TIMEOUT_MS = 60_000;

async function isMongoReachable(baseUri: string): Promise<boolean> {
  const uri = baseUri.replace(/\/$/, '');
  // Parse `mongodb://[user:pass@]host[:port]` best-effort (sufficient for memory server URIs).
  const afterScheme = uri.replace(/^mongodb:\/\//, '');
  const hostPortPart = afterScheme.includes('@')
    ? afterScheme.split('@').slice(-1)[0] ?? ''
    : afterScheme;
  const hostPort = hostPortPart.split('/')[0] ?? '';
  const [hostRaw, portRaw] = hostPort.split(':');
  const host = (hostRaw ?? '').trim() || '127.0.0.1';
  const port = portRaw ? Number(portRaw) : 27017;
  if (!Number.isFinite(port) || port <= 0) {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const s = new net.Socket();
    const done = (ok: boolean) => {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    s.setTimeout(800);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host);
  });
}

/**
 * Resolves the MongoDB connection base (no database name) for API tests.
 *
 * **Jest (default):** `mongodb-memory-server` — `MONGO_TEST_URI` from the shell/compose is ignored
 * so tests do not accidentally use a real DB. Exempt with `OPENAD_TEST_MONGO_INTEGRATION=true`.
 * `jest.config.cts` sets `OPENAD_JEST=1`; workers also have `JEST_WORKER_ID`.
 *
 * **Non-Jest or integration:** set `MONGO_TEST_URI` for Docker/host, or
 * `MONGO_TEST_USE_MEMORY=false` to use `mongodb://127.0.0.1:27017`.
 */
export async function getMongoTestBaseUri(): Promise<string> {
  if (process.env.OPENAD_TEST_MONGO_INTEGRATION !== 'true') {
    if (
      process.env.OPENAD_JEST === '1' ||
      (typeof process.env.JEST_WORKER_ID === 'string' && process.env.JEST_WORKER_ID !== '')
    ) {
      delete process.env.MONGO_TEST_URI;
    }
  }

  const explicit = process.env.MONGO_TEST_URI?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  // When started via Jest globalSetup, persist the chosen URI so other Node processes
  // (edge cases: IDE runners, reruns) can reuse it without spawning new mongod instances.
  try {
    const cached = fs.readFileSync(MONGO_URI_CACHE_PATH, 'utf8').trim();
    if (cached) {
      const base = cached.replace(/\/$/, '');
      if (await isMongoReachable(base)) {
        return base;
      }
    }
  } catch {
    /* cache miss */
  }

  if (process.env.MONGO_TEST_USE_MEMORY === 'false') {
    return 'mongodb://127.0.0.1:27017';
  }

  if (!memoryServer) {
    memoryServer = await MongoMemoryServer.create({
      instance: { launchTimeout: MONGOD_LAUNCH_TIMEOUT_MS },
    });
    try {
      fs.mkdirSync(path.dirname(MONGO_URI_CACHE_PATH), { recursive: true });
      fs.writeFileSync(MONGO_URI_CACHE_PATH, memoryServer.getUri().replace(/\/$/, ''), 'utf8');
    } catch {
      /* best-effort cache write */
    }
  }
  return memoryServer.getUri().replace(/\/$/, '');
}

export async function stopMemoryMongo(): Promise<void> {
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  try {
    fs.unlinkSync(MONGO_URI_CACHE_PATH);
  } catch {
    /* ignore */
  }
}

const DEFAULT_REDIS_TEST_URL = 'redis://127.0.0.1:6379';

/**
 * Quantos bancos logicos o Redis expoe por padrao (`databases 16` no `redis.conf`).
 *
 * Usar o indice do worker modulo este numero significa que, com mais de 16 workers, dois
 * voltariam a compartilhar banco. Nao e problema pratico — o Jest aqui roda com bem menos —
 * e o modulo e preferivel a falhar: um indice fora da faixa derruba a conexao com
 * `ERR DB index is out of range`, que seria um erro pior de diagnosticar do que a colisao
 * que ele evita.
 */
const REDIS_LOGICAL_DBS = 16;

/**
 * Redis URL for API tests. Uses a real Redis instance (e.g. Docker on the dev machine).
 * Resolution order:
 * - `REDIS_TEST_URI` — explicit test override
 * - `REDIS_URL` — same as local API / compose (see `.env.dev`, `.env.test`)
 * - default `redis://127.0.0.1:6379`
 *
 * **Um banco logico por worker do Jest (D21).** O `shutdownTestApp` precisa limpar o Redis
 * entre suites, mas todas as suites compartilhavam o banco 0 e o desligamento fazia
 * `flushall` — que apaga **tudo**, inclusive as chaves de uma suite que ainda esta rodando
 * em outro worker. Nao estourava porque nenhuma suite dependia de estado no Redis entre
 * testes; era intermitencia a espera de acontecer, e aconteceu: a suite de reconciliacao de
 * analytics falhou uma vez e passou sozinha em seguida.
 *
 * Isolar por `JEST_WORKER_ID` resolve sem escopar chave por chave, porque dentro de um
 * worker as suites rodam **em sequencia** — o banco logico fica livre quando a proxima
 * comeca. E `flushdb` no teardown deixou de alcancar os vizinhos.
 */
export async function getRedisTestUrl(): Promise<string> {
  const base =
    process.env.REDIS_TEST_URI?.trim() ||
    process.env.REDIS_URL?.trim() ||
    DEFAULT_REDIS_TEST_URL;

  const worker = Number(process.env.JEST_WORKER_ID ?? '');
  if (!Number.isInteger(worker) || worker < 1) {
    // Fora do Jest (script, execucao manual): mantem a URL como esta, sem escolher banco.
    return base;
  }

  const db = worker % REDIS_LOGICAL_DBS;
  try {
    const url = new URL(base);
    // O caminho da URL do Redis e o indice do banco: `redis://host:6379/3`.
    url.pathname = `/${db}`;
    return url.toString();
  } catch {
    // URL que o `URL` nao parseia (socket unix, forma exotica): seguir sem indice e melhor
    // que falhar a suite inteira por causa do isolamento.
    return base;
  }
}

/** No-op: Redis is external; kept for teardown compatibility. */
export async function stopMemoryRedis(): Promise<void> {
  /* intentionally empty */
}
