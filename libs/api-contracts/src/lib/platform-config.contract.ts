export interface PlatformConfig {
  dashboard: {
    /**
     * Optional. When set, the Dashboard “Media Storage” card shows a % bar.
     * Null/undefined means "unset".
     */
    mediaStorageQuotaBytes: number | null;
  };
  mediaLimits: {
    maxVideoBytes: number;
    maxDurationSeconds: number;
    maxWidth: number;
    maxHeight: number;
  };
  fleetHealth: {
    minBatteryPercent: number;
    maxStoragePercent: number;
    gpsHdopMax: number;
    heartbeatFlaggedThresholdMs: number;
  };
  analytics: {
    maxVelocityKmh: number;
    enabled: boolean;
    playBatchMaxBytes: number;
    reconFullPlayMinRatio: number;
    reconMinDurationSec: number;
    fraudBlackoutMaxLux: number;
    fraudHeartbeatIntervalSec: number;
    fraudHeartbeatMinRatio: number;
  };
}

/** GET /api/v1/platform-config */
export interface PlatformConfigGetResponse {
  active: PlatformConfig;
  defaults: PlatformConfig;
  version: number;
}

/** PUT /api/v1/platform-config */
export interface PlatformConfigPutRequest {
  version: number;
  config: PlatformConfig;
}

/** PUT /api/v1/platform-config/restore-defaults */
export interface PlatformConfigRestoreDefaultsRequest {
  version: number;
}

