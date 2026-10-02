# Data Model: Analytics & Reconciliation Engine

**Feature**: `006-analytics-reconciliation` | **Date**: 2026-04-05

## Core documents (MongoDB)

### `play_records` (collection)

Immutable after insert; reconciliation fills classification fields.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Server id |
| `uniqueEventId` | string (UUID) | Edge-generated unique play id (dedupe key with device) |
| `deviceId` | UUID | |
| `vehicleId` | UUID | |
| `campaignId` | UUID | |
| `mediaId` | UUID | Optional if loop slot references media |
| `scheduleRuleId` | UUID | Optional — ties to schedule row |
| `timestampStart` | Date | |
| `timestampEnd` | Date | |
| `latStart` | number | WGS84 |
| `lngStart` | number | |
| `latEnd` | number | |
| `lngEnd` | number | |
| `triggerReason` | enum | `Geofence_Entry` \| `Standard_Loop` \| `Admin_Force` |
| `batteryLevel` | number | 0–100 |
| `networkType` | string | e.g. `4G`, `5G`, `WiFi`, `none` |
| `gpsAccuracyM` | number | |
| `displayLux` | number \| null | Optional — blackout detection |
| `ingestedAt` | Date | Server receive |
| `batchId` | string | Client batch correlation |
| `reconciliationStatus` | enum | `pending` \| `billable` \| `partial` \| `duplicate` \| `geofence_failed` \| `fraud_velocity` \| `fraud_heartbeat` \| `blackout` \| `audit` |
| `billable` | boolean | Denormalized for reporting |
| `impliedSpeedKmh` | number \| null | For audit |
| `heartbeatRatio` | number \| null | Plays vs heartbeats window — audit |

**Indexes**: `{ deviceId: 1, uniqueEventId: 1 }` unique; `{ campaignId: 1, timestampStart: -1 }`; `{ vehicleId: 1, campaignId: 1, timestampStart: -1 }`; `{ reconciliationStatus: 1, ingestedAt: -1 }`.

### `campaign_daily_spend` (optional materialized)

| Field | Type |
|-------|------|
| `campaignId` | UUID |
| `date` | date (calendar, TZ) |
| `billableCostCents` | number |
| `budgetCents` | number |
| `pacingState` | `normal` \| `near_cap` \| `paused` |

---

## Edge (SQLite) — tablet

### `pending_plays`

Columns mirror contract minimal set; `uploaded` integer 0/1; `unique_event_id` text primary key.

### `outbound_batches`

`batch_id`, `created_at`, `payload_path` or blob, `retry_count`, `status`.

---

## Key relationships

- **Play** → **Campaign** (N:1); **Vehicle** (N:1); **Device** (N:1).
- **Reconciliation** reads **GeoZone** / spatial definition by zone reference when trigger is geofence-related.
