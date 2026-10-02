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
 * Redis URL for API tests. Uses a real Redis instance (e.g. Docker on the dev machine).
 * Resolution order:
 * - `REDIS_TEST_URI` — explicit test override
 * - `REDIS_URL` — same as local API / compose (see `.env.dev`, `.env.test`)
 * - default `redis://127.0.0.1:6379`
 */
export async function getRedisTestUrl(): Promise<string> {
  const testUri = process.env.REDIS_TEST_URI?.trim();
  if (testUri) {
    return testUri;
  }
  const appUri = process.env.REDIS_URL?.trim();
  if (appUri) {
    return appUri;
  }
  return DEFAULT_REDIS_TEST_URL;
}

/** No-op: Redis is external; kept for teardown compatibility. */
export async function stopMemoryRedis(): Promise<void> {
  /* intentionally empty */
}
