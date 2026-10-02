import { z } from 'zod';
import { checkAppUpdatesCommandSchema } from './update-check-command.contract';

/** `openad/{deviceId}/telemetry` — QoS 0 */
export const telemetryPayloadSchema = z.object({
  ts: z.string(),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    accuracyMeters: z.number(),
    gpsLocked: z.boolean(),
  }),
  connectivity: z.object({
    networkType: z.enum(['4G', '5G', 'WiFi', 'none']),
    signalStrengthDbm: z.number().nullable(),
  }),
  playback: z.object({
    status: z.enum(['playing', 'idle', 'error']),
    currentAssetId: z.string().nullable(),
    currentCampaignId: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
  device: z.object({
    batteryPercent: z.number(),
    storageFreeGb: z.number(),
    cpuLoadPercent: z.number(),
    memoryUsedPercent: z.number(),
  }),
  alertFlags: z.array(
    z.enum([
      'LOW_STORAGE',
      'PLAYBACK_ERROR',
      'GPS_LOST',
      'ASSET_CORRUPT',
    ]),
  ),
  /** Optional native snapshot (Capacitor plugins on tablet). */
  nativeExtras: z
    .object({
      accelerometer: z
        .object({ x: z.number(), y: z.number(), z: z.number() })
        .optional(),
      compassHeadingDeg: z.number().optional(),
      ambientLightLux: z.number().optional(),
      wifiSsid: z.string().optional(),
      wifiRssiDbm: z.number().nullable().optional(),
      screenBrightness: z.number().optional(),
      volumePercent: z.number().optional(),
      kioskModeActive: z.boolean().optional(),
      privacyScreenWhenBackgrounded: z.boolean().optional(),
      keepAwakeEnabled: z.boolean().optional(),
    })
    .optional(),
});

/** `openad/{deviceId}/impressions` — QoS 2 */
export const impressionPayloadSchema = z.object({
  eventId: z.string().uuid(),
  ts: z.string(),
  campaignId: z.string(),
  scheduleRuleId: z.string(),
  assetId: z.string(),
  durationPlayedSeconds: z.number(),
  location: z.object({
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    accuracyMeters: z.number().nullable(),
    gpsLocked: z.boolean(),
  }),
});

/** `openad/{deviceId}/commands/ack` — QoS 1 (003: optional resultCode) */
export const commandAckPayloadSchema = z.object({
  commandId: z.string(),
  status: z.enum(['success', 'failure']),
  completedAt: z.string(),
  details: z.string().nullable(),
  resultCode: z
    .enum([
      'OK',
      'TIMEOUT',
      'UPLOAD_FAILED',
      'DOWNLOAD_FAILED',
      'INSTALL_FAILED',
    ])
    .optional(),
});

/** Opaque or null payload for baseline commands (`CLEAR_CACHE` uses the same shape). */
const opaqueCommandPayload = z.union([z.record(z.string(), z.unknown()), z.null()]);

/** RESTART, SYNC_SCHEDULE, CUSTOM — payload is free-form or null. */
const baselineServerCommandSchema = z.object({
  commandId: z.string(),
  type: z.enum(['RESTART', 'SYNC_SCHEDULE', 'CUSTOM']),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: opaqueCommandPayload,
});

const getScreenshotCommandSchema = z.object({
  commandId: z.string(),
  type: z.literal('GET_SCREENSHOT'),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: z.object({
    uploadUrl: z.string().url(),
    uploadHeaders: z.record(z.string(), z.string()).optional(),
    deadlineAt: z.string(),
  }),
});

const clearCacheCommandSchema = z.object({
  commandId: z.string(),
  type: z.literal('CLEAR_CACHE'),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: opaqueCommandPayload,
});

const upgradeAppCommandSchema = z.object({
  commandId: z.string(),
  type: z.literal('UPGRADE_APP'),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: z.object({
    apkUrl: z.string().url(),
    checksumSha256: z.string().optional(),
  }),
});

const levelCommandSchema = z.object({
  commandId: z.string(),
  type: z.enum(['SET_VOLUME', 'SET_BRIGHTNESS']),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: z.object({
    level: z.number().min(0).max(100),
  }),
});

const emergencySyncCommandSchema = z.object({
  commandId: z.string(),
  type: z.literal('EMERGENCY_SYNC'),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: z.union([
    z.object({
      manifestUrl: z.string().url().optional(),
    }),
    z.null(),
  ]),
});

const tempDisableKioskCommandSchema = z.object({
  commandId: z.string(),
  type: z.literal('TEMP_DISABLE_KIOSK'),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: z
    .object({
      durationSeconds: z.number().min(30).max(3600).optional(),
      reason: z.string().max(200).optional(),
    })
    .nullable(),
});

/** `openad/{deviceId}/commands` (server → device) — QoS 1 — 003 discriminated union */
export const serverCommandPayloadSchema = z.union([
  baselineServerCommandSchema,
  clearCacheCommandSchema,
  getScreenshotCommandSchema,
  upgradeAppCommandSchema,
  levelCommandSchema,
  emergencySyncCommandSchema,
  tempDisableKioskCommandSchema,
  checkAppUpdatesCommandSchema,
]);

const geoZoneInRuleSchema = z.object({
  zoneId: z.string(),
  geometry: z.object({
    type: z.string(),
    coordinates: z.unknown(),
  }),
});

const timeWindowSchema = z.object({
  daysOfWeek: z.array(z.string()),
  startTime: z.string(),
  endTime: z.string(),
  timezone: z.string(),
});

const scheduleRuleEntrySchema = z.object({
  ruleId: z.string(),
  priority: z.number(),
  assetId: z.string(),
  assetUrl: z.string().url(),
  assetChecksumSha256: z.string(),
  assetVersion: z.number(),
  geoZones: z.array(geoZoneInRuleSchema),
  timeWindows: z.array(timeWindowSchema),
  dwellThresholdSeconds: z.number(),
  validUntil: z.string(),
});

/** `openad/{deviceId}/schedule` — QoS 1, retained */
export const schedulePayloadSchema = z.object({
  schemaVersion: z.number(),
  generatedAt: z.string(),
  rules: z.array(scheduleRuleEntrySchema),
  fallbackAssetId: z.string().nullable(),
});

export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;
export type ImpressionPayload = z.infer<typeof impressionPayloadSchema>;
export type CommandAckPayload = z.infer<typeof commandAckPayloadSchema>;
export type ServerCommandPayload = z.infer<typeof serverCommandPayloadSchema>;
export type SchedulePayload = z.infer<typeof schedulePayloadSchema>;

export const MQTT_CONTRACT_TOPICS = [
  'telemetry',
  'impressions',
  'commands',
  'commands/ack',
  'schedule',
] as const;
