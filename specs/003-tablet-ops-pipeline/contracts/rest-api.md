# REST API Contracts: Tablet Ops Pipeline

**Feature**: 003-tablet-ops-pipeline  
**Base URL**: `/api/v1`  
**Auth**: Admin endpoints — Bearer JWT with roles (`fleet_admin`, `super_admin`, etc.). Device endpoints — device-scoped JWT (`typ: device`).  
**Source library**: `libs/api-contracts/src/lib/types.ts` — add all new types here.

---

## 1. Pairing — register hardware fingerprint

### `POST /api/v1/devices/pairing/register`

Tablet calls on first launch. Creates or updates a **pending** pairing request.

**Auth**: None or optional device bootstrap token (project policy).

**Request body**:
```typescript
interface PairingRegisterRequest {
  hardwareFingerprint: {
    imei: string | null;
    serialNumber: string;
    macAddress: string;
  };
  /** Optional — client-generated UUID for idempotent retries */
  clientDeviceId?: string;
}
```

**Response `201 Created`**:
```typescript
interface PairingRegisterResponse {
  deviceId: string;
  status: 'Pending';
  flags?: ('FINGERPRINT_UNAVAILABLE')[];
}
```

**Errors**: `400` validation; `409` if device already `Active` (pairing not allowed — retire device first per edge case).

---

## 2. Pairing — admin generate secret

### `POST /api/v1/admin/devices/{deviceId}/pairing-secret`

**Auth**: `fleet_admin` or `super_admin`

**Response `200 OK`**:
```typescript
interface PairingSecretResponse {
  /** Short code for technician entry — maps to hashed server secret */
  displayCode: string;
  expiresAt: string; // ISO 8601, +10 minutes
}
```

**Errors**: `404` device not found; `409` device not in `Pending` or already paired.

---

## 3. Pairing — bind with secret

### `POST /api/v1/devices/pairing/bind`

**Auth**: None (public bind with secret + fingerprint).

**Request body**:
```typescript
interface PairingBindRequest {
  deviceId: string;
  hardwareFingerprint: PairingRegisterRequest['hardwareFingerprint'];
  /** Plaintext one-time code as shown in admin UI */
  secretCode: string;
}
```

**Response `200 OK`**:
```typescript
interface PairingBindResponse {
  deviceId: string;
  accessToken: string; // device JWT
  mqtt: {
    brokerUrl: string;
    username: string;
    password: string;
    clientId: string;
  };
  manifestUrl: string;
  manifestVersion: number;
}
```

**Errors**:
| Status | Code | Condition |
|--------|------|-----------|
| `403` | `HARDWARE_MISMATCH` | Fingerprint does not match registered request |
| `403` | `SECRET_EXPIRED` | TTL elapsed |
| `403` | `SECRET_REPLAY` | Secret already used |
| `404` | `DEVICE_NOT_FOUND` | Unknown `deviceId` |

---

## 4. Authenticated device — any route

Middleware MUST validate:

1. JWT signature and expiry.
2. `fp` claim matches SHA-256 of canonical fingerprint from **this** request (headers or body per convention).

On mismatch: `403` with body `{ "code": "HARDWARE_MISMATCH" }` and security audit log.

---

## 5. Remote commands — admin dispatch

### `POST /api/v1/admin/devices/{deviceId}/commands`

**Auth**: admin roles.

**Request body**:
```typescript
type RemoteCommandType =
  | 'GET_SCREENSHOT'
  | 'CLEAR_CACHE'
  | 'UPGRADE_APP'
  | 'SET_VOLUME'
  | 'SET_BRIGHTNESS'
  | 'EMERGENCY_SYNC';

interface CommandDispatchRequest {
  type: RemoteCommandType;
  payload?: {
    apkUrl?: string;           // UPGRADE_APP — validated reachable before dispatch
    level?: number;            // 0–100 volume / brightness
    /** Override default TTL seconds */
    ttlSeconds?: number;
  };
}
```

**Response `202 Accepted`**:
```typescript
interface CommandDispatchResponse {
  commandId: string;
  status: 'Pending';
  expiresAt: string;
}
```

**Note**: `GET_SCREENSHOT` response may include presigned URL in server-side record only; MQTT payload carries upload URL to tablet.

---

## 6. Remote commands — query lifecycle

### `GET /api/v1/admin/devices/{deviceId}/commands`

Query recent commands for Fleet Monitor UI.

**Response `200 OK`**: paginated list of `RemoteCommand` DTOs with timestamps and status.

---

## 7. Manifest — delta

### `GET /api/v1/devices/{deviceId}/manifest`

**Auth**: device JWT + fingerprint validation.

**Query**: `?sinceVersion=<number>` (optional).

**Response `200 OK`**:
```typescript
interface ManifestDeltaResponse {
  version: number;
  fullSync: boolean;
  added: Array<{
    assetId: string;
    url: string;
    checksumSha256: string;
    sizeBytes: number;
  }>;
  removed: string[]; // assetIds
}
```

First sync: `fullSync: true`, complete asset list.

---

## 8. Device Group — sync windows

### `PATCH /api/v1/admin/device-groups/{groupId}/sync-windows`

**Auth**: admin.

**Request body**:
```typescript
interface SyncWindowsUpdateRequest {
  rules: Array<{
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    sizeThresholdMb: number;
  }>;
}
```

**Response `200 OK`**: updated group; side effect — MQTT config push to all devices in group within one sync cycle (≤ 60 s).

---

## Versioning

New routes and DTOs are **additive** (MINOR bump to API version documentation). Existing device bind from spec 001/002 may be **deprecated** in favour of this flow — document migration in implementation tasks.
