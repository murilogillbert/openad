/** `devices/{deviceId}/heartbeat` — extended payload (spec 002 §4, 003 watchdog). */
export interface HeartbeatPayload {
  deviceId: string;
  timestamp: string;
  location: {
    lat: number;
    lng: number;
    hdop: number | null;
    locked: boolean;
  };
  health: {
    batteryPercentage: number;
    storageUtilizationPercent: number;
    gpsHdop: number | null;
  };
  /** 003: optional operational mode for Fleet Monitor without REST polling. */
  watchdogState?: 'normal' | 'deep_sleep' | 'safety_loop';
  /** ISO timestamp of last successful manifest fetch (tablet-reported). */
  lastManifestFetchAt?: string | null;
}

/** Server → device on `devices/{deviceId}/config`. */
export interface DeviceConfigPayload {
  profileId: string;
  exhibitionRules: {
    maxLoopLengthSeconds: number;
    adToContentRatio: number;
  };
  connectivityMode: 'Economy' | 'Premium';
  commercialTierMultiplier: number;
  effectiveAt: string;
  /** 003 — optional; merged additively with base config. */
  syncWindows?: Array<{
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    sizeThresholdMb: number;
  }>;
  /** 003 — bumped when sync rules change. */
  configRevision?: number;
}

/** Device → server on `devices/{deviceId}/power-state`. */
export interface PowerStatePayload {
  deviceId: string;
  engineOn: boolean;
  voltageV?: number;
  detectionMethod: 'power_disconnect' | 'obd2_voltage';
  timestamp: string;
}
