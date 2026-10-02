# Data Model: End-to-End Media Orchestration Platform for Transit Advertising

**Branch**: `001-transit-ad-platform-foundation`  
**Phase**: 1 — Design  
**Storage**: MongoDB 7.x  
**Date**: 2026-04-04

---

## Entity Relationship Overview

```
User ──────────────────── (manages) ──────────────── Vehicle
                                                         │
                                                    (bound to)
                                                         │
                                                       Device ──── (reports) ──── FleetStatusRecord
                                                         │
                                              (receives) Schedule
                                                         │
Campaign ─── (has many) ─── ScheduleRule ──────────────┘
    │                           │
    │                       GeoZone
    │
    └──── (uses) ──── CreativeAsset
    │
    └──── (generates) ──── ImpressionEvent ◄── (links to) ── Device / Vehicle
```

---

## Collections

---

### `devices`

Represents a physical Android tablet installed in a vehicle.

```json
{
  "_id": "ObjectId",
  "deviceId": "string (UUID v4, system-assigned managed identity)",
  "serialNumber": "string (hardware serial, unique)",
  "status": "enum: unbound | active | inactive | decommissioned",
  "boundVehicleId": "ObjectId | null (ref: vehicles)",
  "boundAt": "Date | null",
  "hardwareProfile": {
    "screenWidthPx": "number",
    "screenHeightPx": "number",
    "screenSizeInches": "number",
    "osVersion": "string",
    "firmwareVersion": "string",
    "storageCapacityGb": "number"
  },
  "mqttClientId": "string (= deviceId, used for broker ACL)",
  "certificateThumbprint": "string (TLS cert fingerprint, pinned at binding)",
  "lastSeenAt": "Date",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes**:
- `{ deviceId: 1 }` — unique
- `{ serialNumber: 1 }` — unique
- `{ status: 1, boundVehicleId: 1 }`
- `{ lastSeenAt: 1 }` — used by offline-detection heartbeat monitor

**Validation Rules**:
- `serialNumber` must be unique across all devices; duplicate insert triggers FR-004 conflict.
- `status` transitions enforced: `unbound → active` (on binding), `active → inactive` (on decommission), `inactive → decommissioned`.
- A device `status: active` MUST have a non-null `boundVehicleId`.

---

### `vehicles`

Represents a physical vehicle in the fleet — the "unit of inventory."

```json
{
  "_id": "ObjectId",
  "vehicleId": "string (UUID v4, system-assigned)",
  "registrationPlate": "string (unique)",
  "make": "string",
  "model": "string",
  "year": "number",
  "status": "enum: active | inactive | decommissioned",
  "assignedZoneId": "ObjectId | null (ref: geo_zones, default operating zone)",
  "boundDeviceId": "ObjectId | null (ref: devices)",
  "operatorId": "ObjectId (ref: users, the driver/operator)",
  "characteristics": {
    "screenCount": "number (default: 1)",
    "passengerCapacity": "number"
  },
  "createdAt": "Date",
  "updatedAt": "Date",
  "decommissionedAt": "Date | null"
}
```

**Indexes**:
- `{ vehicleId: 1 }` — unique
- `{ registrationPlate: 1 }` — unique
- `{ status: 1, assignedZoneId: 1 }`
- `{ boundDeviceId: 1 }` — used for duplicate-binding rejection (FR-004)

**Validation Rules**:
- One vehicle may be bound to at most one device; a device may be bound to at most one vehicle (enforced by unique index on `boundDeviceId`).
- Decommissioning a vehicle (FR-005) sets `status: decommissioned`, nullifies `boundDeviceId`, and enqueues a campaign-reassignment job.

---

### `geo_zones`

Defines a named geographic boundary for campaign targeting.

```json
{
  "_id": "ObjectId",
  "zoneId": "string (UUID v4)",
  "name": "string",
  "description": "string",
  "geometry": {
    "type": "Polygon | Circle",
    "coordinates": "GeoJSON coordinates array (for Polygon)",
    "center": { "type": "Point", "coordinates": ["lng", "lat"] },
    "radiusMeters": "number (for Circle approximation)"
  },
  "city": "string",
  "tags": ["string"],
  "createdBy": "ObjectId (ref: users)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes**:
- `{ geometry: "2dsphere" }` — enables `$geoIntersects` and `$geoWithin` queries (FR-009)
- `{ city: 1, tags: 1 }`

**Validation Rules**:
- GeoJSON polygon coordinates must form a valid closed ring (first and last coordinate equal).
- Circle geometry is stored as a Point + radius; the scheduling engine converts to a polygon approximation for `$geoWithin` queries.

---

### `campaigns`

An advertiser's request to deliver creative content under specified conditions.

```json
{
  "_id": "ObjectId",
  "campaignId": "string (UUID v4)",
  "name": "string",
  "advertiserName": "string",
  "status": "enum: draft | active | paused | completed | archived",
  "priority": "number (1 = highest, higher number = lower priority)",
  "budget": {
    "totalAmount": "number",
    "currency": "string (ISO 4217, e.g. USD)",
    "ratePerImpression": "number"
  },
  "scheduledStart": "Date",
  "scheduledEnd": "Date",
  "createdBy": "ObjectId (ref: users)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes**:
- `{ campaignId: 1 }` — unique
- `{ status: 1, scheduledStart: 1, scheduledEnd: 1 }` — active campaign window queries
- `{ priority: 1, status: 1 }` — priority resolution (FR-010)

**State Transitions**: `draft → active → paused → active → completed → archived`

---

### `creative_assets`

A media file (video or image) associated with a campaign.

```json
{
  "_id": "ObjectId",
  "assetId": "string (UUID v4)",
  "campaignId": "ObjectId (ref: campaigns)",
  "version": "number (increments on update)",
  "filename": "string",
  "mimeType": "enum: video/mp4 | image/jpeg | image/png | image/webp",
  "fileSizeBytes": "number",
  "durationSeconds": "number | null (for video assets)",
  "storageUrl": "string (internal storage path, not public)",
  "checksumSha256": "string (integrity fingerprint, FR-012)",
  "status": "enum: pending | verified | rejected | deprecated",
  "uploadedBy": "ObjectId (ref: users)",
  "uploadedAt": "Date",
  "verifiedAt": "Date | null"
}
```

**Indexes**:
- `{ assetId: 1 }` — unique
- `{ campaignId: 1, version: -1 }` — fetch latest asset for a campaign
- `{ status: 1 }` — find pending-verification assets

**Validation Rules**:
- Only `status: verified` assets are eligible for inclusion in schedule rules (FR-012).
- `checksumSha256` computed server-side at upload; re-verified by device after download.
- On asset update (FR-013): a new document is inserted with `version + 1`; old version transitions to `status: deprecated`.

---

### `schedule_rules`

The binding of a campaign, geo-zone(s), time window(s), and creative asset that governs when and where content plays.

```json
{
  "_id": "ObjectId",
  "ruleId": "string (UUID v4)",
  "campaignId": "ObjectId (ref: campaigns)",
  "assetId": "ObjectId (ref: creative_assets)",
  "geoZoneIds": ["ObjectId (ref: geo_zones)"],
  "timeWindows": [
    {
      "daysOfWeek": ["MON","TUE","WED","THU","FRI"],
      "startTime": "string (HH:MM, 24h local time)",
      "endTime": "string (HH:MM, 24h local time)",
      "timezone": "string (IANA, e.g. America/Sao_Paulo)"
    }
  ],
  "dwellThresholdSeconds": "number (minimum seconds in zone before triggering, default: 30)",
  "priority": "number (inherited from campaign, can be overridden per rule)",
  "status": "enum: active | inactive | expired",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes**:
- `{ campaignId: 1, status: 1 }`
- `{ geoZoneIds: 1, status: 1 }` — find all active rules for a given zone
- `{ assetId: 1 }` — find rules using a specific asset (for propagation on update)

---

### `impression_events`

An immutable record of a single ad play occurrence. Append-only; no updates.

```json
{
  "_id": "ObjectId",
  "eventId": "string (UUID v4, generated by device)",
  "campaignId": "ObjectId (ref: campaigns)",
  "scheduleRuleId": "ObjectId (ref: schedule_rules)",
  "assetId": "ObjectId (ref: creative_assets)",
  "vehicleId": "ObjectId (ref: vehicles)",
  "deviceId": "ObjectId (ref: devices)",
  "playedAt": "Date (timestamp of actual play start, from device clock)",
  "receivedAt": "Date (timestamp of server ingestion)",
  "durationPlayedSeconds": "number",
  "location": {
    "type": "Point",
    "coordinates": ["lng", "lat"],
    "accuracyMeters": "number"
  },
  "locationVerified": "boolean (false = GPS was unavailable at play time, FR-022)",
  "lastKnownLocation": {
    "coordinates": ["lng", "lat"],
    "capturedAt": "Date"
  },
  "mqttDeliveryId": "string (MQTT packet ID for deduplication)",
  "billingValue": "number (ratePerImpression snapshot at time of play)"
}
```

**Indexes**:
- `{ eventId: 1 }` — unique (deduplication across re-delivers)
- `{ campaignId: 1, playedAt: 1 }` — Proof-of-Play report queries (FR-023)
- `{ vehicleId: 1, playedAt: -1 }` — per-vehicle impression history
- `{ location: "2dsphere" }` — geographic reach analysis (FR-025)
- `{ locationVerified: 1, campaignId: 1 }` — disputed events review (FR-027)
- `{ playedAt: 1 }` — TTL or archival policy

**Immutability**: No update or delete operations are permitted post-insert. Any correction creates a new event with a reference to the original (`supersedes: eventId`).

---

### `fleet_status`

Latest state snapshot for each active device. Upserted on every telemetry heartbeat.

```json
{
  "_id": "ObjectId",
  "deviceId": "string (ref: devices.deviceId)",
  "vehicleId": "ObjectId (ref: vehicles)",
  "reportedAt": "Date",
  "location": {
    "type": "Point",
    "coordinates": ["lng", "lat"],
    "accuracyMeters": "number"
  },
  "connectivity": {
    "status": "enum: online | degraded | offline",
    "signalStrengthDbm": "number | null",
    "networkType": "enum: 4G | 5G | WiFi | none"
  },
  "playback": {
    "status": "enum: playing | idle | error",
    "currentAssetId": "ObjectId | null",
    "currentCampaignId": "ObjectId | null"
  },
  "device": {
    "batteryPercent": "number",
    "storageFreeGb": "number",
    "cpuLoadPercent": "number",
    "memoryUsedPercent": "number"
  },
  "alertFlags": ["string (e.g. 'LOW_STORAGE', 'PLAYBACK_ERROR', 'GPS_LOST')"]
}
```

**Indexes**:
- `{ deviceId: 1 }` — unique (upsert key)
- `{ 'connectivity.status': 1, reportedAt: 1 }` — offline detection sweep
- `{ location: "2dsphere" }` — geographic dashboard cluster rendering

---

### `remote_commands`

Commands issued from the dashboard to individual devices.

```json
{
  "_id": "ObjectId",
  "commandId": "string (UUID v4)",
  "deviceId": "string (target device managed identity)",
  "vehicleId": "ObjectId (ref: vehicles)",
  "issuedBy": "ObjectId (ref: users)",
  "type": "enum: RESTART | SYNC_SCHEDULE | CLEAR_CACHE | UPDATE_FIRMWARE | CUSTOM",
  "payload": "object | null (type-specific parameters)",
  "status": "enum: queued | delivered | acknowledged | failed | expired",
  "issuedAt": "Date",
  "deliveredAt": "Date | null",
  "acknowledgedAt": "Date | null",
  "expiresAt": "Date (TTL for undelivered commands, default: 24h)",
  "deviceResponse": "object | null (outcome payload from device ACK)",
  "mqttPublishId": "string | null"
}
```

**Indexes**:
- `{ commandId: 1 }` — unique
- `{ deviceId: 1, status: 1, issuedAt: -1 }` — queue drain on device reconnect (FR-019)
- `{ issuedAt: 1 }`, TTL index on `expiresAt` — auto-expire stale commands

---

### `users`

Portal user accounts with role-based access.

```json
{
  "_id": "ObjectId",
  "userId": "string (UUID v4)",
  "email": "string (unique)",
  "displayName": "string",
  "role": "enum: fleet_operator | campaign_manager | fleet_admin | finance_analyst | super_admin",
  "status": "enum: active | suspended",
  "passwordHash": "string (bcrypt, never returned in API responses)",
  "refreshTokenHash": "string | null",
  "createdAt": "Date",
  "updatedAt": "Date",
  "lastLoginAt": "Date | null"
}
```

**Indexes**:
- `{ userId: 1 }` — unique
- `{ email: 1 }` — unique

---

## State Machine Summary

| Entity | States | Key Transitions |
|---|---|---|
| Device | `unbound → active → inactive → decommissioned` | Binding, decommission, replacement |
| Vehicle | `active → inactive → decommissioned` | Decommission triggers campaign reassignment |
| Campaign | `draft → active → paused → active → completed → archived` | Schedule window open/close, manual pause |
| CreativeAsset | `pending → verified → deprecated` (or `rejected`) | Integrity check, asset update |
| ScheduleRule | `active → inactive → expired` | Campaign end, manual pause |
| RemoteCommand | `queued → delivered → acknowledged` (or `failed / expired`) | MQTT delivery + device ACK |
| ImpressionEvent | Immutable after insert | Corrections via supersedes reference |
