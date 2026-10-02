# Data Model: Geospatial Intelligence & Triggering Engine

**Feature**: `005-geospatial-triggering-engine` | **Date**: 2026-04-05

## Server-side (MongoDB-oriented)

### SpatialZone

| Field | Type | Notes |
|-------|------|--------|
| `zoneId` | UUID | Stable identifier; referenced in manifest and ledger |
| `name` | string | Display name |
| `geometry` | discriminated union | `circle: { centerLng, centerLat, radiusMeters }` OR `polygon: GeoJSON coordinates` |
| `tier` | enum | `T1` \| `T2` \| `T3` \| `T4` (maps to spec tiers) |
| `priorityScore` | number | Used in overlap + manifest ordering |
| `bufferExitMeters` | number | Hysteresis exit buffer (FR-010) |
| `isActive` | boolean | Soft-disable |
| `createdAt` / `updatedAt` | ISO timestamps | Audit |

**Relationships**: Many-to-many with campaigns/creatives via junction records or embedded `mediaIds[]` per deployment choice.

### SpatialTriggerBinding

Links a zone to creatives and trigger semantics (may be embedded in campaign documents instead).

| Field | Type | Notes |
|-------|------|--------|
| `bindingId` | UUID | |
| `zoneId` | UUID | |
| `mediaId` | UUID | Creative reference |
| `triggerMode` | enum | `entry` \| `dwell` |
| `dwellSeconds` | number? | Required when `dwell` |
| `retriggerCooldownSeconds` | number | FR-011 |
| `rotationMode` | enum | `sequential` \| `weighted_random` \| `priority_first` |
| `velocityMaxKmh` | number? | High-speed silencing threshold |
| `velocityMinKmh` | number? | Dwell/airport-style low-speed gate |
| `arbitrationWeights` | object | `wp, wd, wh` pacing/distance/heading weights (FR-019) |
| `epicenter` | `{ lng, lat }`? | For inverse-distance term |

### SpatialLedgerEvent (abstract)

Stored for analytics; subtypes below.

### SpatialReceipt

| Field | Type | Notes |
|-------|------|--------|
| `eventId` | UUID | |
| `deviceId` | UUID | |
| `mediaId` | UUID | |
| `zoneId` | UUID | |
| `startedAt` / `endedAt` | ISO | |
| `coordinateStart` | `{ lat, lng }` | FR-013 |
| `coordinateEnd` | `{ lat, lng }` | |
| `accuracyMeters` | number | GPS accuracy at play time |
| `tier` | enum | Snapshot |

### ZoneResidencyInterval

| Field | Type | Notes |
|-------|------|--------|
| `intervalId` | UUID | |
| `deviceId` | UUID | |
| `zoneId` | UUID | |
| `enteredAt` | ISO | |
| `exitedAt` | ISO? | Null if open |
| `playedAds` | boolean | Whether any spatial ad ran (for “available time” semantics) |

### LostOpportunityEvent

| Field | Type | Notes |
|-------|------|--------|
| `eventId` | UUID | |
| `deviceId` | UUID | |
| `suppressedMediaId` | UUID | Loser |
| `winningMediaId` | UUID? | Winner if known |
| `reason` | enum | `higher_tier` \| `cooldown` \| `velocity` \| `pacing` \| … |
| `zoneId` | UUID | |
| `ts` | ISO | |

---

## Tablet-side (local persistence)

### LastPlayedStore (IndexedDB or SQLite via Capacitor)

| Key | Value |
|-----|--------|
| composite `(mediaId \| ruleId)` | `{ lastPlayedAt: ISO }` |

### GeofenceStateMachine (in-memory + optional persist)

Per `zoneId`: `outside | inside | dwelling(since)` with hysteresis flags.

### ShadowQueue

Fixed-length list (3 slots) of `{ mediaId, tier, score, etaHint }` — ephemeral, rebuilt on timer.

---

## Validation rules

- Circle: `radiusMeters > 0`, center within valid lat/lng.
- Polygon: closed ring, ≥ 4 points, self-intersection check best-effort server-side.
- Dwell: `dwellSeconds ≥ 0` when mode is `dwell`.
- Tier: required on every spatially bound creative.
