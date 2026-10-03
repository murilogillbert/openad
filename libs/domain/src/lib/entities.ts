/**
 * Shared domain types aligned with `specs/001-transit-ad-platform-foundation/data-model.md`.
 * Stored shape uses MongoDB; these are the portable TypeScript contracts.
 */

/** Formal lifecycle — see `specs/002-device-state-machine/data-model.md`. */
export type DeviceLifecycleState =
  | 'Pending'
  | 'Active'
  | 'Flagged'
  | 'Suspended'
  | 'Retired';

export interface DeviceHardwareProfile {
  screenWidthPx: number;
  screenHeightPx: number;
  screenSizeInches: number;
  osVersion: string;
  firmwareVersion?: string;
  storageCapacityGb: number;
}

/** Runtime-reported capability snapshot (replaces hardware-only profile). */
export interface CapabilityManifest {
  screenWidthPx: number;
  screenHeightPx: number;
  screenSizeInches: number;
  totalStorageGb: number;
  availableStorageGb: number;
  osVersion: string;
  appVersion: string;
  firmwareVersion?: string;
  reportedAt: string;
}

export interface HealthMetrics {
  batteryPercentage: number;
  storageUtilizationPercent: number;
  gpsHdop: number | null;
  gpsLocked: boolean;
  reportedAt: string;
}

export type EventTriggerType = 'system' | 'admin';

export interface DeviceLifecycleEventTrigger {
  type: EventTriggerType;
  detail: string;
  actorId?: string;
}

export interface DeviceLifecycleEvent {
  eventId: string;
  deviceId: string;
  fromState: DeviceLifecycleState;
  toState: DeviceLifecycleState;
  trigger: DeviceLifecycleEventTrigger;
  occurredAt: string;
}

export interface RetiredDeviceRegistryEntry {
  deviceId: string;
  retiredAt: string;
  retiredByAdminId: string;
}

/** 003 tablet ops — hardware binding (canonical hash in `hardwareFingerprintHash` on device + JWT `fp`). */
export interface HardwareFingerprint {
  imei: string | null;
  serialNumber: string;
  macAddress: string;
  canonicalHash: string;
}

export type PairingRequestStatus =
  | 'Pending'
  | 'Bound'
  | 'Expired'
  | 'Cancelled';

export type PairingAttemptOutcome =
  | 'success'
  | 'failure'
  | 'expired'
  | 'replay'
  | 'hardware_mismatch';

export type WatchdogEventType =
  | 'deep_sleep_entered'
  | 'deep_sleep_exited'
  | 'safety_loop_entered'
  | 'safety_loop_exited'
  | 'player_restarted'
  | 'manifest_unreachable';

export interface WatchdogEvent {
  eventId: string;
  deviceId: string;
  eventType: WatchdogEventType;
  occurredAt: string;
  context?: Record<string, unknown>;
}

export type ConnectivityMode = 'Economy' | 'Premium';

export interface ExhibitionRules {
  maxLoopLengthSeconds: number;
  adToContentRatio: number;
}

export interface ConfigurationProfile {
  profileId: string;
  name: string;
  exhibitionRules: ExhibitionRules;
  connectivityMode: ConnectivityMode;
  commercialTierMultiplier: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceGroup {
  groupId: string;
  name: string;
  profileId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  deviceId: string;
  serialNumber: string;
  /** 003 — SHA-256 fingerprint at bind; optional until migration/backfill. */
  hardwareFingerprintHash?: string | null;
  /** 003 — manifest delta cursor. */
  lastManifestVersion?: number;
  pairingCompletedAt?: string | null;
  mqttCredentialsRotatedAt?: string | null;
  lifecycleState: DeviceLifecycleState;
  groupId?: string | null;
  boundVehicleId: string | null;
  boundAt: string | null;
  hardwareProfile: DeviceHardwareProfile;
  capabilityManifest?: CapabilityManifest | null;
  mqttClientId: string;
  certificateThumbprint: string;
  lastSeenAt: string;
  lastHealthMetrics?: HealthMetrics | null;
  createdAt: string;
  updatedAt: string;
}

export type VehicleStatus = 'active' | 'inactive' | 'decommissioned';

export interface VehicleCharacteristics {
  screenCount: number;
  passengerCapacity: number;
}

export interface Vehicle {
  vehicleId: string;
  registrationPlate: string;
  make: string;
  model: string;
  year: number;
  status: VehicleStatus;
  pairedDeviceIds: string[];
  commercialTier: 'premium' | 'taxi' | 'van' | 'other';
  /** Optional FK to operator/driver directory when present. */
  driverId: string | null;
  /** When true, roster treats unit as in-shop (suppresses offline churn per 008). */
  inShop: boolean;
  operatorId: string;
  characteristics: VehicleCharacteristics;
  createdAt: string;
  updatedAt: string;
  decommissionedAt: string | null;
}

export type GeoJsonType = 'Polygon' | 'Circle';

export interface GeoZoneGeometry {
  type: GeoJsonType;
  coordinates?: number[][][] | number[][] | number[];
  center?: { type: 'Point'; coordinates: [number, number] };
  radiusMeters?: number;
}

export interface GeoZone {
  zoneId: string;
  name: string;
  description: string;
  geometry: GeoZoneGeometry;
  city: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

export interface CampaignBudget {
  totalAmount: number;
  currency: string;
  ratePerImpression: number;
}

export interface Campaign {
  campaignId: string;
  name: string;
  advertiserName: string;
  priority: number;
  scheduledStart: string;
  scheduledEnd: string;
  budget: CampaignBudget;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export type CreativeAssetStatus = 'pending' | 'verified' | 'rejected' | 'deprecated';

export interface CreativeAsset {
  assetId: string;
  campaignId: string;
  version: number;
  checksumSha256: string;
  mimeType: string;
  status: CreativeAssetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRule {
  ruleId: string;
  campaignId: string;
  assetId: string;
  geoZoneIds: string[];
  dwellThresholdSeconds: number;
  priority: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImpressionLocation {
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  gpsLocked: boolean;
}

export interface ImpressionEvent {
  eventId: string;
  deviceId: string;
  vehicleId: string;
  campaignId: string;
  scheduleRuleId: string;
  assetId: string;
  playedAt: string;
  durationPlayedSeconds: number;
  location: ImpressionLocation;
  locationVerified: boolean;
  billingValue: number;
  currency: string;
}

/**
 * Papeis da equipe interna da plataforma, persistidos em `openad.users` no MongoDB.
 *
 * Estes sao os unicos papeis que o openad **emite**. Todo token com um papel daqui foi
 * assinado por este servico.
 */
export type InternalUserRole =
  | 'fleet_operator'
  | 'campaign_manager'
  | 'content_moderator'
  | 'fleet_admin'
  | 'finance_analyst'
  | 'super_admin';

/**
 * Papel de quem entra pela identidade federada do ecossistema.
 *
 * Nao e persistido em `openad.users` e **nao vem do token**: e derivado da existencia de
 * linha em `openad.ad_advertisers` para o `sub` do token do hub. Essa distincao e de
 * seguranca, nao de estilo — ver `FederatedIdentityService`.
 */
export type FederatedUserRole = 'advertiser';

export type UserRole = InternalUserRole | FederatedUserRole;

/**
 * Papeis da equipe interna, em `openad.users`.
 *
 * O anunciante **nao** entra aqui, e o tipo garante isso: a lista e `InternalUserRole[]`, de
 * modo que acrescentar `'advertiser'` aqui nao compila. Antes a garantia era um comentario.
 *
 * O motivo e concreto. `isInternalRole` decide se a consulta e escopada por dono: um papel
 * considerado interno recebe filtro vazio e **ve tudo de todos**. Se o anunciante entrasse
 * nesta lista, o isolamento entre parceiros cairia por inteiro, sem erro nenhum aparecer.
 */
export const INTERNAL_USER_ROLES: readonly InternalUserRole[] = [
  'fleet_operator',
  'campaign_manager',
  'content_moderator',
  'fleet_admin',
  'finance_analyst',
  'super_admin',
];
