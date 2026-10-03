import type {
  CapabilityManifest,
  DeviceHardwareProfile,
  DeviceLifecycleState,
  HealthMetrics,
  UserRole,
  VehicleCharacteristics,
} from '@openad/domain';

/** 008 — vehicle roster binding rollup (worst-case device + in-shop override). */
export type VehicleBindingStatus =
  | 'fully_operational'
  | 'hardware_missing'
  | 'hardware_offline'
  | 'in_shop';

export interface VehicleBindingAuditEntry {
  eventId: string;
  action: 'pair' | 'unpair' | 'decommission';
  vehicleId: string;
  deviceId: string | null;
  actorUserId: string;
  createdAt: string;
}

export interface VehicleBindingAuditListResponse {
  items: VehicleBindingAuditEntry[];
  nextCursor: string | null;
}

/** Standard API error envelope (see Phase 2 HTTP exception filter). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** POST /api/v1/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    userId: string;
    displayName: string;
    role: UserRole;
  };
}

/** POST /api/v1/auth/refresh */
export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}

/** POST /api/v1/devices/inventory-register — Pending device by serial; pair elsewhere. */
export interface DeviceInventoryRegisterRequest {
  serialNumber: string;
  /** Optional; 0 stored until device reports. */
  screenSizeInches?: number;
  /** Optional; `"pending"` stored if omitted. */
  osVersion?: string;
  /** Optional; 0 stored until device reports. */
  storageCapacityGb?: number;
}

/** Same shape as tablet pairing register — device UUID + Pending status. */
export interface DeviceInventoryRegisterResponse {
  deviceId: string;
  status: 'Pending';
  flags?: string[];
}

/** GET /api/v1/vehicles */
export interface VehicleListItem {
  vehicleId: string;
  registrationPlate: string;
  make: string;
  model: string;
  status: string;
  pairedDeviceIds: string[];
  bindingStatus: VehicleBindingStatus;
  /** Maintenance / in-shop — roster binding UI treats as suppressed when true. */
  inShop: boolean;
  boundDevice: {
    deviceId: string;
    lifecycleState: DeviceLifecycleState;
    lastSeenAt: string;
  } | null;
}

export interface Paginated<T> {
  data: T[];
  pagination: { total: number; page: number; limit: number };
}

export interface VehicleListQuery {
  status?: 'active' | 'inactive' | 'decommissioned';
  make?: string;
  model?: string;
  page?: number;
  limit?: number;
}

/** DELETE /api/v1/vehicles/{vehicleId} */
export interface VehicleDecommissionResponse {
  vehicleId: string;
  status: 'decommissioned';
  affectedCampaigns: string[];
}

/** GET /api/v1/vehicles/{vehicleId} */
export interface VehicleDetailResponse {
  vehicleId: string;
  registrationPlate: string;
  make: string;
  model: string;
  year: number;
  status: string;
  operatorId: string;
  commercialTier: 'premium' | 'taxi' | 'van' | 'other';
  pairedDeviceIds: string[];
  bindingStatus: VehicleBindingStatus;
  driverId: string | null;
  inShop: boolean;
  characteristics: VehicleCharacteristics;
  decommissionedAt: string | null;
  boundDevice: null | {
    deviceId: string;
    serialNumber: string;
    lifecycleState: DeviceLifecycleState;
    lastSeenAt: string;
    hardwareProfile: DeviceHardwareProfile;
    capabilityManifest: CapabilityManifest | null;
    lastHealthMetrics: HealthMetrics | null;
    /** 009 — reported installed app release from device (if any). */
    currentRelease: {
      versionIdentifier: string;
      installedAt: string;
    } | null;
    /** 009 — last update check outcome from device. */
    updateState: {
      lastCheckAt: string | null;
      lastCheckResult:
        | 'up_to_date'
        | 'update_available'
        | 'update_failed'
        | 'unknown';
      lastError: string | null;
    } | null;
  };
}

/** PATCH /api/v1/vehicles/{vehicleId} */
export interface VehicleUpdateRequest {
  registrationPlate?: string;
  make?: string;
  model?: string;
  year?: number;
  commercialTier?: 'premium' | 'taxi' | 'van' | 'other';
  driverId?: string | null;
  inShop?: boolean;
  characteristics?: Partial<VehicleCharacteristics>;
}

/** POST /api/v1/vehicles — vehicle onboarding (008 US2). */
export interface CreateVehicleRequest {
  registrationPlate: string;
  make: string;
  model: string;
  year: number;
  commercialTier?: 'premium' | 'taxi' | 'van' | 'other';
  driverId?: string | null;
  /** Pair these existing devices after create (may unpair from other vehicles). */
  pairedDeviceIds?: string[];
}

/** GET /api/v1/devices — operator tablet inventory (008 US3). */
export interface DeviceInventoryItem {
  deviceId: string;
  serialNumber: string;
  lifecycleState: DeviceLifecycleState;
  lastSeenAt: string;
  boundVehicleId: string | null;
  boundVehicleRegistrationPlate: string | null;
}

export interface DeviceListQuery {
  page?: number;
  limit?: number;
  lifecycleState?: DeviceLifecycleState;
  /** Case-insensitive substring match on `serialNumber` or `deviceId`. */
  search?: string;
}

/** POST /api/v1/campaigns — valores monetarios em centavos inteiros. */
export interface CreateCampaignRequest {
  name: string;
  advertiserName: string;
  priority: number;
  scheduledStart: string;
  scheduledEnd: string;
  budget: {
    totalAmountCents: number;
    currency: string;
    ratePerImpressionCents: number;
    dailyBudgetCents?: number | null;
  };
}

/** POST /api/v1/campaigns/{id}/rules */
export interface CreateScheduleRuleRequest {
  assetId: string;
  geoZoneIds: string[];
  timeWindows: {
    daysOfWeek: string[];
    startTime: string;
    endTime: string;
    timezone: string;
  }[];
  dwellThresholdSeconds: number;
  priority: number | null;
}

/** PATCH /api/v1/campaigns/{id}/status */
export interface CampaignStatusPatch {
  status: 'active' | 'paused' | 'completed';
}

/** POST /api/v1/geo-zones */
export interface CreateGeoZoneRequest {
  name: string;
  description: string;
  city: string;
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  tags: string[];
}

/** GET /api/v1/fleet/status */
export interface FleetStatusItem {
  deviceId: string;
  vehicleId: string;
  reportedAt: string;
  location: { lng: number; lat: number };
  connectivity: { status: 'online' | 'degraded' | 'offline' };
  playback: {
    status: 'playing' | 'idle' | 'error';
    currentCampaignId: string | null;
  };
  alertFlags: string[];
}

export interface FleetStatusResponse {
  data: FleetStatusItem[];
  staleBefore: string;
}

/** GET /api/v1/fleet/map/meta */
export interface FleetMapMetaResponse {
  cities: string[];
  campaigns: { campaignId: string; name: string }[];
  commercialTiers: readonly ['premium', 'taxi', 'van', 'other'];
  deviceStatusFilters: readonly ['online', 'offline', 'syncing'];
}

/** GET /api/v1/fleet/map/snapshot — live markers + aggregate counts */
export type FleetMapMotionState = 'moving' | 'idle' | 'offline' | 'syncing';

export interface FleetMapMarker {
  deviceId: string;
  vehicleId: string;
  registrationPlate: string;
  deviceLabel: string;
  lat: number;
  lng: number;
  motionState: FleetMapMotionState;
  connectivity: FleetStatusItem['connectivity'];
  playback: FleetStatusItem['playback'];
  commercialTier: 'premium' | 'taxi' | 'van' | 'other';
  zoneCity: string | null;
  reportedAt: string;
  lastAccuracyMeters: number | null;
}

export interface FleetMapSnapshotResponse {
  markers: FleetMapMarker[];
  counts: { moving: number; idle: number; offline: number; syncing: number };
  generatedAt: string;
  zones: FleetMapZoneOutline[];
}

/** Active geo zone outlines for map layer (when enabled in UI). */
export interface FleetMapZoneOutline {
  zoneId: string;
  name: string;
  city: string;
  geometry: GeoJsonPolygon | GeoJsonCirclePayload;
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJsonCirclePayload {
  type: 'Circle';
  center: { lng: number; lat: number };
  radiusMeters: number;
}

/** GET /api/v1/fleet/map/devices/:deviceId/detail */
export interface FleetMapDeviceDetailResponse {
  deviceId: string;
  vehicleId: string;
  registrationPlate: string;
  deviceLabel: string;
  serialNumber: string;
  motionState: FleetMapMotionState;
  location: { lat: number; lng: number };
  lastAccuracyMeters: number | null;
  reportedAt: string;
  connectivity: FleetStatusItem['connectivity'];
  playback: FleetStatusItem['playback'];
  commercialTier: 'premium' | 'taxi' | 'van' | 'other';
  zoneCity: string | null;
  /** Approx. data usage signal: inverse of storage free ratio (0–100). */
  dataUsagePercent: number;
  hourlyPlays: { hour: string; count: number }[];
  currentAd: {
    campaignId: string | null;
    campaignName: string | null;
    assetId: string | null;
    thumbnailUrl: string | null;
  };
}

/** Remote command types — 002 baseline + 003 tablet ops extensions. */
export type RemoteCommandType =
  | 'RESTART'
  | 'SYNC_SCHEDULE'
  | 'CLEAR_CACHE'
  | 'CUSTOM'
  | 'GET_SCREENSHOT'
  | 'UPGRADE_APP'
  | 'SET_VOLUME'
  | 'SET_BRIGHTNESS'
  | 'EMERGENCY_SYNC'
  | 'TEMP_DISABLE_KIOSK';

export type RemoteCommandStatus =
  | 'queued'
  | 'dispatched'
  | 'acknowledged'
  | 'failed'
  | 'Pending'
  | 'Delivered'
  | 'Acknowledged'
  | 'Acknowledged_Failure'
  | 'Expired'
  | 'Failed';

/** POST /api/v1/fleet/devices/{deviceId}/commands */
export interface IssueCommandRequest {
  type: RemoteCommandType;
  payload: Record<string, unknown> | null;
}

export interface IssueCommandResponse {
  commandId: string;
  /** New commands use `Pending` per 003 lifecycle; `queued` retained for older clients. */
  status: 'Pending' | 'queued';
  expiresAt: string;
}

export interface RemoteCommandListItem {
  commandId: string;
  deviceId: string;
  type: RemoteCommandType;
  status: RemoteCommandStatus;
  issuedAt: string;
  expiresAt: string;
  acknowledgedAt: string | null;
  /** When the server published the command to MQTT (003). */
  deliveredAt?: string | null;
  /** Time-limited HTTPS URL to view uploaded screenshot (GET_SCREENSHOT). */
  screenshotUrl?: string | null;
}

export interface RemoteCommandListResponse {
  data: RemoteCommandListItem[];
}

/** GET /api/v1/reports/impressions/{eventId} */
export interface ImpressionEventDetail {
  eventId: string;
  deviceId: string;
  vehicleId: string;
  campaignId: string;
  scheduleRuleId: string;
  assetId: string;
  playedAt: string;
  receivedAt: string;
  durationPlayedSeconds: number;
  location: {
    lat: number | null;
    lng: number | null;
    accuracyMeters: number | null;
  };
  locationVerified: boolean;
  /** Valor faturavel congelado no momento da veiculacao, em centavos inteiros. */
  billingValueCents: number;
  currency: string;
}

/** POST /api/v1/reports/proof-of-play */
export interface ProofOfPlayRequest {
  campaignId: string;
  format: 'json' | 'csv' | 'pdf';
}

export interface ReportJobAccepted {
  reportJobId: string;
  status: 'queued';
  estimatedReadyAt: string;
}

export interface ReportJobStatus {
  reportJobId: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  downloadUrl: string | null;
  summary: {
    totalImpressions: number;
    uniqueZonesReached: number;
    estimatedUniquePassengersReached: number;
    totalBillableValueCents: number;
    currency: string;
  };
}

/**
 * GET /api/v1/reports/billing — valores monetarios em **centavos inteiros**.
 *
 * O sufixo `Cents` e parte do contrato, nao detalhe de implementacao: `billableValue` sem
 * unidade no nome foi o que permitiu o pacing comparar reais com centavos por 100 veiculacoes
 * sem ninguem notar.
 */
export interface BillingReportResponse {
  period: { start: string; end: string };
  byCampaign: {
    campaignId: string;
    campaignName: string;
    impressions: number;
    billableValueCents: number;
    currency: string;
  }[];
  byOperator: {
    operatorId: string;
    vehicleCount: number;
    impressions: number;
    payableAmountCents: number;
  }[];
}

/** PATCH /api/v1/devices/{deviceId}/state */
export interface DeviceStateTransitionRequest {
  toState: 'Suspended' | 'Active' | 'Retired';
  reason: string;
}

export interface DeviceStateTransitionResponse {
  deviceId: string;
  fromState: DeviceLifecycleState;
  toState: DeviceLifecycleState;
  eventId: string;
  transitionedAt: string;
}

/** GET /api/v1/devices/{deviceId}/lifecycle-events */
export interface DeviceLifecycleEventsResponse {
  data: {
    eventId: string;
    fromState: DeviceLifecycleState;
    toState: DeviceLifecycleState;
    trigger: {
      type: 'system' | 'admin';
      detail: string;
      actorId?: string;
    };
    occurredAt: string;
  }[];
  pagination: { total: number; page: number; limit: number };
}

/** PATCH /api/v1/devices/{deviceId}/capability-manifest */
export interface CapabilityManifestUpdateRequest {
  screenWidthPx: number;
  screenHeightPx: number;
  screenSizeInches: number;
  totalStorageGb: number;
  availableStorageGb: number;
  osVersion: string;
  appVersion: string;
  firmwareVersion?: string;
}

export interface CapabilityManifestUpdateResponse {
  deviceId: string;
  manifestUpdatedAt: string;
}

/** POST /api/v1/configuration-profiles */
export interface CreateConfigurationProfileRequest {
  name: string;
  exhibitionRules: {
    maxLoopLengthSeconds: number;
    adToContentRatio: number;
  };
  connectivityMode: 'Economy' | 'Premium';
  commercialTierMultiplier: number;
}

export interface ConfigurationProfileResponse {
  profileId: string;
  name: string;
  exhibitionRules: {
    maxLoopLengthSeconds: number;
    adToContentRatio: number;
  };
  connectivityMode: 'Economy' | 'Premium';
  commercialTierMultiplier: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/v1/device-groups */
export interface CreateDeviceGroupRequest {
  name: string;
  profileId: string;
}

/** 003 — sync window rule (group-level; pushed via MQTT config). */
export interface SyncWindowRuleDto {
  ruleId: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  sizeThresholdMb: number;
}

export interface DeviceGroupResponse {
  groupId: string;
  name: string;
  profileId: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  /** 003 — optional; omitted when unset. */
  syncWindowRules?: SyncWindowRuleDto[];
  /** 003 — bumped when sync windows change. */
  configRevision?: number;
}

export interface GroupMembershipUpdateRequest {
  deviceIds: string[];
}

export interface ConfigSyncCompleteEvent {
  type: 'config_sync_complete';
  profileId: string;
  groupId: string;
  deviceCount: number;
  syncedAt: string;
}

export interface GroupMembershipUpdateResponse {
  groupId: string;
  addedDeviceIds: string[];
  removedFromGroupIds: Record<string, string[]>;
  triggeredConfigSync: boolean;
  configSyncComplete?: ConfigSyncCompleteEvent;
}

export interface DeviceStateChangedEvent {
  type: 'device_state_changed';
  deviceId: string;
  vehicleId: string | null;
  fromState: DeviceLifecycleState;
  toState: DeviceLifecycleState;
  trigger: { type: 'system' | 'admin'; detail: string };
  occurredAt: string;
}

/** 003 — POST /api/v1/devices/pairing/register */
export interface PairingRegisterRequest {
  hardwareFingerprint: {
    imei: string | null;
    serialNumber: string;
    macAddress: string;
  };
  clientDeviceId?: string;
}

export interface PairingRegisterResponse {
  deviceId: string;
  status: 'Pending';
  flags?: ('FINGERPRINT_UNAVAILABLE')[];
}

/** 003 — POST /api/v1/devices/pairing/bind */
export interface PairingBindRequest {
  deviceId: string;
  hardwareFingerprint: PairingRegisterRequest['hardwareFingerprint'];
  secretCode: string;
}

export interface PairingBindResponse {
  deviceId: string;
  accessToken: string;
  mqtt: {
    brokerUrl: string;
    username: string;
    password: string;
    clientId: string;
  };
  manifestUrl: string;
  manifestVersion: number;
}

/** Device JWT payload — include `fp` when `hardwareFingerprintHash` is set on device. */
export interface DeviceAccessTokenPayload {
  sub: string;
  typ: 'device';
  fp?: string;
}

/** 003 — POST /api/v1/admin/devices/:deviceId/pairing-secret */
export interface PairingSecretResponse {
  displayCode: string;
  expiresAt: string;
}

/** GET /api/v1/admin/devices/pending-pairings */
export interface PendingPairingDevice {
  deviceId: string;
  serialNumber: string;
  createdAt: string;
}

export interface PendingPairingListResponse {
  data: PendingPairingDevice[];
}

/** PATCH /api/v1/admin/device-groups/:groupId/sync-windows */
export interface SyncWindowsUpdateRequest {
  rules: Array<{
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    sizeThresholdMb: number;
  }>;
}
