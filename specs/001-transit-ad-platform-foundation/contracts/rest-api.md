# Interface Contracts: REST API

**Branch**: `001-transit-ad-platform-foundation`  
**Version**: v1  
**Base URL**: `/api/v1`  
**Auth**: Bearer JWT (all endpoints unless marked public)

---

## Authentication

### `POST /api/v1/auth/login`
Authenticate a portal user and receive access + refresh tokens.

**Request**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response 200**
```json
{
  "accessToken": "string (JWT, 15min expiry)",
  "refreshToken": "string (opaque, 30-day expiry)",
  "user": {
    "userId": "string",
    "displayName": "string",
    "role": "fleet_operator | campaign_manager | fleet_admin | finance_analyst | super_admin"
  }
}
```

**Errors**: `401 Unauthorized`, `422 Validation Error`

---

### `POST /api/v1/auth/refresh`
Exchange a refresh token for a new access token.

**Request**: `{ "refreshToken": "string" }`  
**Response 200**: `{ "accessToken": "string" }`  
**Errors**: `401 Unauthorized` (invalid/expired refresh token)

---

## Devices & Inventory

### `POST /api/v1/devices/bind`
Bind an unregistered tablet to a vehicle (FR-001, FR-006).

**Roles**: `fleet_operator`, `fleet_admin`

**Request**
```json
{
  "serialNumber": "string",
  "vehicleId": "string",
  "hardwareProfile": {
    "screenWidthPx": "number",
    "screenHeightPx": "number",
    "screenSizeInches": "number",
    "osVersion": "string",
    "storageCapacityGb": "number"
  }
}
```

**Response 201**
```json
{
  "deviceId": "string (system-assigned UUID)",
  "mqttClientId": "string",
  "certificateThumbprint": "string",
  "status": "active",
  "boundVehicleId": "string"
}
```

**Errors**:  
- `409 Conflict` — device serial already bound or vehicle already has a device  
- `404 Not Found` — vehicleId does not exist  
- `422 Validation Error`

---

### `DELETE /api/v1/devices/{deviceId}/bind`
Unbind a device from its vehicle (decommission / emergency replacement).

**Roles**: `fleet_admin`  
**Response 200**: `{ "deviceId": "string", "status": "inactive" }`

---

### `GET /api/v1/vehicles`
Search and filter the vehicle inventory catalog (FR-003).

**Roles**: `fleet_operator`, `fleet_admin`, `campaign_manager`

**Query Parameters**:
| Param | Type | Description |
|---|---|---|
| `status` | `active \| inactive \| decommissioned` | Filter by vehicle status |
| `zoneId` | `string` | Filter by assigned geo-zone |
| `make` | `string` | Filter by vehicle make |
| `model` | `string` | Filter by vehicle model |
| `page` | `number` (default: 1) | Pagination |
| `limit` | `number` (default: 50, max: 500) | Page size |

**Response 200**
```json
{
  "data": [
    {
      "vehicleId": "string",
      "registrationPlate": "string",
      "make": "string",
      "model": "string",
      "status": "string",
      "assignedZoneId": "string | null",
      "boundDevice": {
        "deviceId": "string",
        "status": "string",
        "lastSeenAt": "ISO8601"
      } 
    }
  ],
  "pagination": { "total": "number", "page": "number", "limit": "number" }
}
```

---

### `DELETE /api/v1/vehicles/{vehicleId}`
Decommission a vehicle from active inventory (FR-005).

**Roles**: `fleet_admin`  
**Response 200**: `{ "vehicleId": "string", "status": "decommissioned", "affectedCampaigns": ["campaignId"] }`

---

## Campaigns

### `POST /api/v1/campaigns`
Create a new campaign (FR-007).

**Roles**: `campaign_manager`

**Request**
```json
{
  "name": "string",
  "advertiserName": "string",
  "priority": "number (1 = highest)",
  "scheduledStart": "ISO8601",
  "scheduledEnd": "ISO8601",
  "budget": {
    "totalAmount": "number",
    "currency": "string (ISO 4217)",
    "ratePerImpression": "number"
  }
}
```

**Response 201**: Full campaign object with `campaignId`, `status: draft`

---

### `POST /api/v1/campaigns/{campaignId}/assets`
Upload a creative asset for a campaign (FR-012).

**Roles**: `campaign_manager`  
**Content-Type**: `multipart/form-data`  
**Body**: `file: <binary>`, `mimeType: string`

**Response 201**
```json
{
  "assetId": "string",
  "version": 1,
  "checksumSha256": "string",
  "status": "pending"
}
```

*Asset transitions to `verified` after server-side integrity check (async, ≤ 30s).*

---

### `POST /api/v1/campaigns/{campaignId}/rules`
Add a schedule rule to a campaign (FR-007, FR-008).

**Roles**: `campaign_manager`

**Request**
```json
{
  "assetId": "string",
  "geoZoneIds": ["string"],
  "timeWindows": [
    {
      "daysOfWeek": ["MON","TUE","WED","THU","FRI"],
      "startTime": "07:00",
      "endTime": "09:00",
      "timezone": "America/Sao_Paulo"
    }
  ],
  "dwellThresholdSeconds": 30,
  "priority": "number | null (inherits from campaign if null)"
}
```

**Response 201**: Full schedule rule object with `ruleId`

**Errors**: `400` — assetId not `verified`, geoZoneIds not found

---

### `PATCH /api/v1/campaigns/{campaignId}/status`
Activate, pause, or complete a campaign.

**Roles**: `campaign_manager`, `fleet_admin`  
**Body**: `{ "status": "active | paused | completed" }`  
**Response 200**: Updated campaign object

---

## Geo-Zones

### `POST /api/v1/geo-zones`
Define a new geographic targeting zone.

**Roles**: `campaign_manager`, `fleet_admin`

**Request**
```json
{
  "name": "string",
  "description": "string",
  "city": "string",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lng, lat], [lng, lat], "..."]]
  },
  "tags": ["string"]
}
```

**Response 201**: Full geo-zone object with `zoneId`

---

### `GET /api/v1/geo-zones`
List all geo-zones, optionally filtered by city or tag.

**Query**: `city`, `tag`, `page`, `limit`  
**Response 200**: Paginated list of geo-zone summaries

---

## Fleet Dashboard

### `GET /api/v1/fleet/status`
Retrieve latest status for all active vehicles (powers dashboard, FR-014).

**Roles**: `fleet_admin`, `fleet_operator`

**Response 200**
```json
{
  "data": [
    {
      "deviceId": "string",
      "vehicleId": "string",
      "reportedAt": "ISO8601",
      "location": { "lng": "number", "lat": "number" },
      "connectivity": { "status": "online | degraded | offline" },
      "playback": { "status": "playing | idle | error", "currentCampaignId": "string | null" },
      "alertFlags": ["string"]
    }
  ],
  "staleBefore": "ISO8601 (records older than this are considered offline)"
}
```

---

### `POST /api/v1/fleet/devices/{deviceId}/commands`
Issue a remote command to a device (FR-018, FR-019).

**Roles**: `fleet_admin`

**Request**
```json
{
  "type": "RESTART | SYNC_SCHEDULE | CLEAR_CACHE | CUSTOM",
  "payload": "object | null"
}
```

**Response 202**
```json
{
  "commandId": "string",
  "status": "queued",
  "expiresAt": "ISO8601"
}
```

---

### `GET /api/v1/fleet/devices/{deviceId}/commands`
List command history for a device, including pending and acknowledged commands (FR-020).

**Roles**: `fleet_admin`  
**Query**: `status`, `page`, `limit`  
**Response 200**: Paginated list of remote command records

---

## Reporting

### `POST /api/v1/reports/proof-of-play`
Request a Proof-of-Play report for a campaign (FR-023, FR-024).

**Roles**: `finance_analyst`, `fleet_admin`

**Request**: `{ "campaignId": "string", "format": "json | csv | pdf" }`

**Response 202**
```json
{
  "reportJobId": "string",
  "status": "queued",
  "estimatedReadyAt": "ISO8601"
}
```

---

### `GET /api/v1/reports/{reportJobId}`
Poll report generation status and retrieve download URL when ready.

**Response 200**
```json
{
  "reportJobId": "string",
  "status": "queued | processing | ready | failed",
  "downloadUrl": "string | null (pre-signed URL, 1h expiry)",
  "summary": {
    "totalImpressions": "number",
    "uniqueZonesReached": "number",
    "estimatedUniquePassengersReached": "number",
    "totalBillableValue": "number",
    "currency": "string"
  }
}
```

---

### `GET /api/v1/reports/impressions/{eventId}`
Retrieve a single impression event in full detail for dispute resolution (FR-027).

**Roles**: `finance_analyst`, `fleet_admin`  
**Response 200**: Full `ImpressionEvent` document

---

### `GET /api/v1/reports/billing`
Get a billing cycle summary disaggregated by campaign and vehicle operator (FR-026).

**Roles**: `finance_analyst`

**Query**: `billingCycleStart: ISO8601`, `billingCycleEnd: ISO8601`

**Response 200**
```json
{
  "period": { "start": "ISO8601", "end": "ISO8601" },
  "byCampaign": [
    {
      "campaignId": "string",
      "campaignName": "string",
      "impressions": "number",
      "billableValue": "number",
      "currency": "string"
    }
  ],
  "byOperator": [
    {
      "operatorId": "string",
      "vehicleCount": "number",
      "impressions": "number",
      "payableAmount": "number"
    }
  ]
}
```
