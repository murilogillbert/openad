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

const schema = z
  .object({
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
