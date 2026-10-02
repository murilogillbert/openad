import { z } from 'zod';

/**
 * Optional numeric env vars with documented defaults (spec 002 / quickstart).
 * Unknown keys pass through for the rest of the app.
 */
const optionalPositive = (key: string, defaultValue: number) =>
  z.preprocess((raw) => {
    if (raw === undefined || raw === '') {
      return defaultValue;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
    throw new Error(`Invalid ${key}: expected positive number`);
  }, z.number());

/**
 * Segredo compartilhado do ecossistema.
 *
 * O mesmo `JWT_SECRET` vale no hub, no opendriver e aqui — um token emitido por um servico
 * autentica nos outros. Por isso o piso de 32 caracteres: e a mesma verificacao que o
 * `assertProductionConfig()` do opendriver faz, e um segredo curto compromete os tres
 * servicos de uma vez, nao so este.
 */
const segredoCompartilhado = (chave: string) =>
  z
    .string({ message: `${chave} e obrigatorio` })
    .min(32, `${chave} precisa ter ao menos 32 caracteres (vale nos tres servicos)`);

/**
 * Obrigatorio em producao, opcional fora dela.
 *
 * O Postgres guarda identidade e dinheiro, e a maior parte da API nao o consulta — as suites
 * de teste, por exemplo, rodam inteiras no Mongo em memoria. Exigir a conexao sempre
 * obrigaria um Postgres de pe para rodar teste de reproducao de video. Em producao, ao
 * contrario, faltar e falha de configuracao e tem de derrubar o boot.
 */
const obrigatorioEmProducao = (chave: string, formato: z.ZodString) =>
  z.preprocess((bruto) => {
    const valor = typeof bruto === 'string' ? bruto.trim() : bruto;
    if (valor === undefined || valor === '') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`${chave} e obrigatorio em producao`);
      }
      return undefined;
    }
    return valor;
  }, formato.optional());

const schema = z
  .object({
    /**
     * Conexao do Postgres compartilhado. **Precisa carregar `?schema=openad`**: e isso que
     * coloca o historico de migrations no schema do openad em vez de no `public` do hub.
     */
    DATABASE_URL: obrigatorioEmProducao(
      'DATABASE_URL',
      z.string().refine((v) => v.includes('schema=openad'), {
        message:
          'DATABASE_URL precisa de ?schema=openad, senao as migrations do openad vao para o schema do hub',
      })
    ),
    MONGO_URI: obrigatorioEmProducao('MONGO_URI', z.string().min(1)),
    REDIS_URL: obrigatorioEmProducao('REDIS_URL', z.string().min(1)),
    JWT_SECRET: segredoCompartilhado('JWT_SECRET'),
    JWT_REFRESH_SECRET: segredoCompartilhado('JWT_REFRESH_SECRET'),
    POWER_ENGINE_OFF_VOLTAGE_V: optionalPositive(
      'POWER_ENGINE_OFF_VOLTAGE_V',
      12
    ),
    POWER_ENGINE_OFF_GRACE_MS: optionalPositive(
      'POWER_ENGINE_OFF_GRACE_MS',
      30_000
    ),
    REPORT_EXPORT_RETENTION_DAYS: optionalPositive(
      'REPORT_EXPORT_RETENTION_DAYS',
      30
    ),
    SCREENSHOT_RETENTION_DAYS: optionalPositive(
      'SCREENSHOT_RETENTION_DAYS',
      14
    ),
    /** Public origin for absolute download URLs in release manifests (e.g. https://api.example.com). */
    PUBLIC_API_BASE_URL: z.string().url().optional(),
    /** S3 key prefix for APK objects (default applied in ReleasesStorageService). */
    RELEASE_APK_OBJECT_PREFIX: z.string().min(1).optional(),
  })
  .passthrough();

export function validateEnv(
  config: Record<string, unknown>
): Record<string, unknown> {
  return schema.parse(config);
}
