# Contract: Playback play record & batch (draft)

**Feature**: `006-analytics-reconciliation` | **Date**: 2026-04-05  
**Implementation target**: `libs/api-contracts/src/analytics/playback-play-record.contract.ts` (Zod)

## Trigger reason

`z.enum(['Geofence_Entry', 'Standard_Loop', 'Admin_Force'])`

## Single play record (edge → core)

| Field | Zod | Notes |
|-------|-----|--------|
| `uniqueEventId` | `z.string().uuid()` | Idempotency key with `deviceId` |
| `deviceId` | `z.string().uuid()` | |
| `vehicleId` | `z.string().uuid()` | |
| `campaignId` | `z.string().uuid()` | |
| `mediaId` | `z.string().uuid().optional()` | |
| `timestampStart` | `z.string().datetime()` | ISO-8601 |
| `timestampEnd` | `z.string().datetime()` | |
| `latStart` | `z.number()` | |
| `lngStart` | `z.number()` | |
| `latEnd` | `z.number()` | |
| `lngEnd` | `z.number()` | |
| `triggerReason` | trigger enum | |
| `batteryLevel` | `z.number().min(0).max(100)` | |
| `networkType` | `z.string()` | |
| `gpsAccuracyM` | `z.number().nonnegative()` | |
| `displayLux` | `z.number().optional()` | Blackout detection when present |

## Batch upload

| Field | Zod | Notes |
|-------|-----|--------|
| `schemaVersion` | `z.literal(1)` | |
| `batchId` | `z.string().uuid()` | Client batch id for retries |
| `deviceId` | `z.string().uuid()` | |
| `plays` | `z.array(playRecord)` | Max length **100** (config) |
| `compressed` | `z.literal(false)` optional | If raw JSON; gzip handled at HTTP layer |

**HTTP**: `POST /api/v1/analytics/play-batches` (path TBD in implementation); `Content-Encoding: gzip` when body compressed.

## Versioning

Bump `schemaVersion` on breaking field changes; reject unknown versions with 400 + structured error.
