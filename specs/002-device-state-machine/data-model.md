# Data Model: Device State Machine and Configuration Profiles

**Feature**: 002-device-state-machine  
**Date**: 2026-04-05  
**Source**: Derived from `spec.md` (Key Entities) and `research.md`

---

## Overview

This document defines the authoritative data model for all new and modified entities introduced by this feature. Each entity maps to a MongoDB collection (or a sub-document on an existing collection) and a corresponding TypeScript type in `libs/domain`.

---

## New & Modified Entities

### 1. `DeviceLifecycleState` (enum) — NEW

Replaces and extends the existing `DeviceStatus` type.

```typescript
// libs/domain/src/lib/entities.ts

/**
 * Formal device lifecycle states.
 * Replaces the previous DeviceStatus (unbound | active | inactive | decommissioned).
 * All state transitions are governed by DeviceStateMachineService.
 */
export type DeviceLifecycleState =
  | 'Pending'       // Registered but not yet paired
  | 'Active'        // Paired, heartbeat regular, allowed to serve commercial media
  | 'Flagged'       // Heartbeat active but health metrics failing; restricted operation
  | 'Suspended'     // Admin-initiated cutoff; no ad playback or media downloads
  | 'Retired';      // Permanently decommissioned; UUID blacklisted
```

> **Migration note**: Existing `DeviceStatus` values map as follows:
> - `unbound` → `Pending`
> - `active` → `Active`
> - `inactive` → `Flagged` (closest semantic match; reviewed on migration)
> - `decommissioned` → `Retired`

---

### 2. `CapabilityManifest` (sub-document) — NEW

Replaces the existing `DeviceHardwareProfile` sub-document. Extends it with runtime state fields.

```typescript
// libs/domain/src/lib/entities.ts

export interface CapabilityManifest {
  screenWidthPx: number;
  screenHeightPx: number;
  screenSizeInches: number;
  totalStorageGb: number;        // Physical total (replaces storageCapacityGb)
  availableStorageGb: number;    // Remaining free space at time of last manifest report
  osVersion: string;
  appVersion: string;            // NEW — tablet app semver (e.g., "2.1.4")
  firmwareVersion?: string;
  reportedAt: string;            // ISO 8601 — when this manifest was submitted
}
```

---

### 3. `Device` (document) — MODIFIED

**Collection**: `devices`  
**Extends**: existing schema in `app/openad-api/src/modules/devices/devices.schema.ts`

```typescript
// libs/domain/src/lib/entities.ts (updated)

export interface Device {
  deviceId: string;                        // UUID — immutable after creation
  serialNumber: string;
  lifecycleState: DeviceLifecycleState;    // RENAMED from status (see migration note)
  groupId: string | null;                  // NEW — FK → DeviceGroup.groupId
  boundVehicleId: string | null;
  boundAt: string | null;
  capabilityManifest: CapabilityManifest;  // REPLACED hardwareProfile
  mqttClientId: string;
  certificateThumbprint: string;
  lastSeenAt: string;
  lastHealthMetrics: HealthMetrics | null;  // NEW — cached from latest heartbeat
  createdAt: string;
  updatedAt: string;
}
```

**MongoDB schema additions**:
```
devices collection index:
  { lifecycleState: 1, groupId: 1 }        // NEW
  { 'capabilityManifest.availableStorageGb': 1 } // NEW — for content targeting queries
```

---

### 4. `DeviceLifecycleEvent` (document) — NEW

**Collection**: `device_lifecycle_events` (append-only)

```typescript
// libs/domain/src/lib/entities.ts

export type EventTriggerType = 'system' | 'admin';

export interface DeviceLifecycleEventTrigger {
  type: EventTriggerType;
  detail: string;     // e.g., 'heartbeat_timeout', 'health_threshold:battery', 'admin_suspend'
  actorId?: string;   // Admin user ID — present when type === 'admin'
}

export interface DeviceLifecycleEvent {
  eventId: string;              // UUID
  deviceId: string;             // FK → Device.deviceId
  fromState: DeviceLifecycleState;
  toState: DeviceLifecycleState;
  trigger: DeviceLifecycleEventTrigger;
  occurredAt: string;           // ISO 8601 — server-generated
}
```

**MongoDB schema**:
```
device_lifecycle_events indexes:
  { deviceId: 1, occurredAt: -1 }   // timeline lookup per device
  { occurredAt: -1 }                // global audit sweep
  { toState: 1, occurredAt: -1 }    // state-specific reporting
```

---

### 5. `RetiredDeviceRegistry` (document) — NEW

**Collection**: `retired_device_registry` (compact blacklist)

```typescript
// libs/domain/src/lib/entities.ts

export interface RetiredDeviceRegistryEntry {
  deviceId: string;    // Indexed, unique
  retiredAt: string;   // ISO 8601
  retiredByAdminId: string;
}
```

**MongoDB schema**:
```
retired_device_registry indexes:
  { deviceId: 1 }  // unique, sparse index — sub-millisecond lookup on every inbound request
```

---

### 6. `HealthMetrics` (sub-document / event payload) — NEW

Used both as a snapshot on `Device.lastHealthMetrics` and as the structure within `DeviceHealthReport` MQTT messages.

```typescript
// libs/domain/src/lib/entities.ts

export interface HealthMetrics {
  batteryPercentage: number;       // 0–100
  storageUtilizationPercent: number; // 0–100 (derived: (total - available) / total * 100)
  gpsHdop: number | null;          // Horizontal Dilution of Precision; null if GPS unavailable
  gpsLocked: boolean;
  reportedAt: string;              // ISO 8601 — device-reported timestamp
}
```

---

### 7. `ConfigurationProfile` (document) — NEW

**Collection**: `configuration_profiles`

```typescript
// libs/domain/src/lib/entities.ts

export type ConnectivityMode = 'Economy' | 'Premium';

export interface ExhibitionRules {
  maxLoopLengthSeconds: number;       // e.g., 120
  adToContentRatio: number;           // e.g., 3 (ads per 1 non-ad content unit)
}

export interface ConfigurationProfile {
  profileId: string;                  // UUID
  name: string;
  exhibitionRules: ExhibitionRules;
  connectivityMode: ConnectivityMode;
  commercialTierMultiplier: number;   // e.g., 1.0 (standard), 2.0 (VIP Black Car)
  isDefault: boolean;                 // At most one default profile exists system-wide
  createdAt: string;
  updatedAt: string;
}
```

**MongoDB schema**:
```
configuration_profiles indexes:
  { isDefault: 1 }      // for fast fallback lookup on profile deletion
  { name: 1 }           // unique index — no duplicate profile names
```

---

### 8. `DeviceGroup` (document) — NEW

**Collection**: `device_groups`

```typescript
// libs/domain/src/lib/entities.ts

export interface DeviceGroup {
  groupId: string;        // UUID
  name: string;           // e.g., 'Airport Fleet', 'Luxury Sedans'
  profileId: string;      // FK → ConfigurationProfile.profileId
  createdAt: string;
  updatedAt: string;
}
```

**MongoDB schema**:
```
device_groups indexes:
  { name: 1 }      // unique index — no duplicate group names
  { profileId: 1 } // for cascade queries when a profile is deleted
```

> **Note**: Members are queried as `devices.find({ groupId })` — no embedded member array (avoids unbounded document growth).

---

## Entity Relationship Diagram

```
DeviceGroup
  ├── profileId ──────────────► ConfigurationProfile
  └── [members via devices.groupId]
                                     │
Device ──── groupId ─────────────────┘
  ├── lifecycleState (DeviceLifecycleState)
  ├── capabilityManifest (CapabilityManifest)
  ├── lastHealthMetrics (HealthMetrics)
  └── [events via device_lifecycle_events.deviceId]
                │
DeviceLifecycleEvent ──── deviceId ──► Device
RetiredDeviceRegistry ─── deviceId ──► Device (blacklist)
```

---

## Validation Rules

| Entity | Field | Rule |
|--------|-------|------|
| `Device` | `lifecycleState` | Must be one of the 5 enum values; transitions validated by `DeviceStateMachineService` |
| `Device` | `groupId` | Nullable; when set, must reference an existing `DeviceGroup.groupId` |
| `CapabilityManifest` | `availableStorageGb` | Must be ≤ `totalStorageGb`; must be ≥ 0 |
| `HealthMetrics` | `batteryPercentage` | 0–100 inclusive |
| `HealthMetrics` | `storageUtilizationPercent` | 0–100 inclusive |
| `HealthMetrics` | `gpsHdop` | Must be > 0 when not null |
| `ConfigurationProfile` | `adToContentRatio` | Must be ≥ 1 (integer) |
| `ConfigurationProfile` | `maxLoopLengthSeconds` | Must be ≥ 10 and ≤ 3600 |
| `ConfigurationProfile` | `commercialTierMultiplier` | Must be > 0; max 10.0 |
| `ConfigurationProfile` | `isDefault` | At most one profile with `isDefault: true` per system (enforced by service, not DB unique index) |
| `DeviceGroup` | `profileId` | Must reference an existing `ConfigurationProfile`; cannot reference a deleted profile |
| `DeviceLifecycleEvent` | `fromState → toState` | Must match the allowed transition table defined in `DeviceStateMachineService` |
| `RetiredDeviceRegistry` | `deviceId` | Unique; immutable after insertion |

---

## State Transition Matrix

Valid `(fromState, toState)` pairs — all others are REJECTED by `DeviceStateMachineService`:

| From \ To | Pending | Active | Flagged | Suspended | Retired |
|-----------|---------|--------|---------|-----------|---------|
| **Pending** | — | ✅ (first heartbeat) | ❌ | ❌ | ✅ (admin) |
| **Active** | ❌ | — | ✅ (system/auto) | ✅ (admin) | ✅ (admin) |
| **Flagged** | ❌ | ✅ (metrics recover) | — | ✅ (admin) | ✅ (admin) |
| **Suspended** | ❌ | ✅ (admin reinstate) | ❌ | — | ✅ (admin) |
| **Retired** | ❌ | ❌ | ❌ | ❌ | — |
