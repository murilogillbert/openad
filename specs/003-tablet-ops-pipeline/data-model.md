# Data Model: Tablet Ops Pipeline

**Feature**: 003-tablet-ops-pipeline  
**Date**: 2026-04-05  
**Source**: `spec.md` (Key Entities), `research.md`, alignment with 002-device-state-machine `Device` lifecycle

---

## Overview

New and updated MongoDB collections and TypeScript types. **`Device`** lifecycle states (`Pending`, `Active`, …) follow spec **002**; this feature adds **pairing artefacts**, **remote commands**, **manifest versioning**, **sync rules**, and **watchdog events**.

---

## 1. `HardwareFingerprint` (value object)

Canonical representation sent from tablet at registration and bind time.

| Field | Type | Notes |
|-------|------|--------|
| `imei` | `string \| null` | May be null on Wi-Fi-only tablets |
| `serialNumber` | `string` | Device serial |
| `macAddress` | `string` | Normalised uppercase hex with colons |
| `canonicalHash` | `string` | SHA-256 of normalised tuple — stored on `Device` and in JWT claim `fp` |

**Validation**: If all required fields per platform policy are null — flag `FINGERPRINT_UNAVAILABLE` on pairing request (edge case).

---

## 2. `PairingRequest` (collection: `pairing_requests`)

| Field | Type | Notes |
|-------|------|--------|
| `requestId` | `string (UUID)` | PK |
| `deviceId` | `string (UUID)` | Provisional or final device id |
| `hardwareFingerprint` | embedded | Full fingerprint (not only hash) for admin review — encrypted at rest if policy requires |
| `status` | `'Pending' \| 'Bound' \| 'Expired' \| 'Cancelled'` | |
| `createdAt` | `Date` | |
| `expiresAt` | `Date \| null` | Optional registration expiry |
| `flags` | `string[]` | e.g. `FINGERPRINT_UNAVAILABLE` |

**Indexes**: `{ deviceId: 1 }`, `{ status: 1, createdAt: -1 }`

---

## 3. `PairingSecret` (collection: `pairing_secrets` or embedded subdoc on `PairingRequest`)

Single-use secret per admin generation.

| Field | Type | Notes |
|-------|------|--------|
| `secretId` | `string (UUID)` | |
| `requestId` | `string` | FK → pairing request |
| `hash` | `string` | Hash of high-entropy secret |
| `displayCode` | `string` | Short code for admin UI (if distinct from typed input mapping) |
| `ttlExpiresAt` | `Date` | 10 minutes from creation |
| `usedAt` | `Date \| null` | Set on first use attempt; invalidates reuse |
| `createdAt` | `Date` | |

---

## 4. `Device` (collection: `devices`) — extensions

Extends 002 model with:

| Field | Type | Notes |
|-------|------|--------|
| `hardwareFingerprintHash` | `string` | Authoritative bind target |
| `lastManifestVersion` | `number` | For delta generation |
| `pairingCompletedAt` | `Date \| null` | |
| `mqttCredentialsRotatedAt` | `Date \| null` | Optional ops field |

Pairing flow: `lifecycleState` = `Pending` until successful bind → `Active`.

---

## 5. `RemoteCommand` (collection: `remote_commands`)

| Field | Type | Notes |
|-------|------|--------|
| `commandId` | `string (UUID)` | |
| `deviceId` | `string` | |
| `type` | enum | `GET_SCREENSHOT`, `CLEAR_CACHE`, `UPGRADE_APP`, `SET_VOLUME`, `SET_BRIGHTNESS`, `EMERGENCY_SYNC`, … |
| `payload` | `object` | URL for upgrade, presigned URL for screenshot, level 0–100 for volume/brightness |
| `status` | enum | `Pending`, `Delivered`, `Acknowledged`, `Acknowledged_Failure`, `Expired`, `Failed` |
| `dispatchedAt` | `Date` | |
| `deliveredAt` | `Date \| null` | |
| `acknowledgedAt` | `Date \| null` | |
| `ttlSeconds` | `number` | Per-type default overridable |
| `expiresAt` | `Date` | TTL index |
| `failureReason` | `string \| null` | e.g. `download_failed` |

**Indexes**: `{ deviceId: 1, dispatchedAt: -1 }`, `{ expiresAt: 1 }` (TTL optional — or cron marks expired)

---

## 6. `ManifestVersion` (server-side manifest registry)

Either a global **campaign/manifest** collection or per-device snapshot:

| Field | Type | Notes |
|-------|------|--------|
| `manifestVersion` | `number` | Monotonic per fleet or per device group |
| `assetIds` | `string[]` | Snapshot for diff |
| `generatedAt` | `Date` | |

Device stores **`lastManifestVersion`**; API computes diff from `ManifestVersion` snapshots.

---

## 7. `SyncWindowRule` (collection or embedded on `DeviceGroup`)

| Field | Type | Notes |
|-------|------|--------|
| `ruleId` | `string` | |
| `groupId` | `string` | FK → `DeviceGroup` |
| `startTime` | `string` | `HH:mm` local interpretation on device |
| `endTime` | `string` | |
| `daysOfWeek` | `number[]` | 0–6 |
| `sizeThresholdMb` | `number` | Defer downloads larger than this outside window |

Pushed via `devices/{deviceId}/config` MQTT (see `research.md`).

---

## 8. `WatchdogEvent` (collection: `watchdog_events`)

| Field | Type | Notes |
|-------|------|--------|
| `eventId` | `string (UUID)` | |
| `deviceId` | `string` | |
| `eventType` | enum | `deep_sleep_entered`, `deep_sleep_exited`, `safety_loop_entered`, `safety_loop_exited`, `player_restarted`, `manifest_unreachable` |
| `occurredAt` | `Date` | |
| `context` | `object` | Optional battery %, manifest URL error, etc. |

**Indexes**: `{ deviceId: 1, occurredAt: -1 }`

---

## 9. `PairingAttemptLog` (append-only audit)

| Field | Type | Notes |
|-------|------|--------|
| `logId` | `string` | |
| `deviceId` | `string \| null` | |
| `fingerprintHash` | `string` | |
| `outcome` | enum | `success`, `failure`, `expired`, `replay`, `hardware_mismatch` |
| `occurredAt` | `Date` | |
| `detail` | `string \| null` | |

FR-007.

---

## State transitions (summary)

- **Pairing**: `PairingRequest(Pending)` + secret issued → tablet binds → `Device(Active)`, secret `usedAt` set, JWT issued.
- **Command**: `Pending` → `Delivered` (MQTT publish) → `Acknowledged` / `Acknowledged_Failure` / `Failed` / `Expired` per spec.

---

## Library mapping

| Concept | Location |
|---------|----------|
| Entity types | `libs/domain/src/lib/entities.ts` |
| REST DTOs | `libs/api-contracts/src/lib/types.ts` |
| MQTT Zod | `libs/mqtt-contracts/src/lib/schemas.ts` |
