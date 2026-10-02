# API Contracts: Device State Machine Endpoints

**Feature**: 002-device-state-machine  
**Base URL**: `/api/v1`  
**Auth**: Bearer JWT required on all endpoints unless noted  
**Source library**: `libs/api-contracts/src/lib/types.ts` — add all new types here

---

## 1. Device State Machine

### `PATCH /api/v1/devices/{deviceId}/state`

Transition a device to a new lifecycle state. Admin-initiated transitions only (Suspended, Retired, Active reinstatement).

**Authorization**: Roles `fleet_admin`, `super_admin`

**Path Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `deviceId` | `string (UUID)` | Target device identifier |

**Request Body**:
```typescript
interface DeviceStateTransitionRequest {
  toState: 'Suspended' | 'Active' | 'Retired';
  reason: string;    // Required. Admin-provided justification. Min 10 chars.
}
```

**Response `200 OK`**:
```typescript
interface DeviceStateTransitionResponse {
  deviceId: string;
  fromState: DeviceLifecycleState;
  toState: DeviceLifecycleState;
  eventId: string;          // Created DeviceLifecycleEvent ID
  transitionedAt: string;   // ISO 8601
}
```

**Error Responses**:
| Status | Code | Condition |
|--------|------|-----------|
| `400` | `INVALID_TRANSITION` | Transition not permitted by state machine (e.g., Retired → Active) |
| `403` | `FORBIDDEN` | Caller lacks required role |
| `404` | `DEVICE_NOT_FOUND` | No device with this ID |
| `409` | `DEVICE_RETIRED` | Device is blacklisted; no transitions allowed |

---

### `GET /api/v1/devices/{deviceId}/lifecycle-events`

Retrieve the full state transition audit log for a device.

**Authorization**: Roles `fleet_admin`, `fleet_operator`, `super_admin`

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | `number` | `1` | Pagination page |
| `limit` | `number` | `50` | Max 100 |

**Response `200 OK`**:
```typescript
interface DeviceLifecycleEventsResponse {
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
```

---

### `PATCH /api/v1/devices/{deviceId}/capability-manifest`

Update a device's capability manifest (called by the tablet after pairing or on app update).

**Authorization**: Device JWT (device-scoped JWT, issued at bind time)

**Request Body**:
```typescript
interface CapabilityManifestUpdateRequest {
  screenWidthPx: number;
  screenHeightPx: number;
  screenSizeInches: number;
  totalStorageGb: number;
  availableStorageGb: number;
  osVersion: string;
  appVersion: string;
  firmwareVersion?: string;
}
```

**Response `200 OK`**:
```typescript
interface CapabilityManifestUpdateResponse {
  deviceId: string;
  manifestUpdatedAt: string;   // ISO 8601
}
```

---

## 2. Configuration Profiles

### `POST /api/v1/configuration-profiles`

Create a new Configuration Profile.

**Authorization**: Roles `fleet_admin`, `super_admin`

**Request Body**:
```typescript
interface CreateConfigurationProfileRequest {
  name: string;                      // Unique. Max 80 chars.
  exhibitionRules: {
    maxLoopLengthSeconds: number;    // 10–3600
    adToContentRatio: number;        // Integer ≥ 1
  };
  connectivityMode: 'Economy' | 'Premium';
  commercialTierMultiplier: number;  // 0.1–10.0 (2 decimal places)
}
```

**Response `201 Created`**:
```typescript
interface ConfigurationProfileResponse {
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
```

**Error Responses**:
| Status | Code | Condition |
|--------|------|-----------|
| `409` | `PROFILE_NAME_CONFLICT` | Profile with this name already exists |

---

### `GET /api/v1/configuration-profiles`

List all profiles.

**Response `200 OK`**: `Paginated<ConfigurationProfileResponse>`

---

### `GET /api/v1/configuration-profiles/{profileId}`

Get a single profile.

**Response `200 OK`**: `ConfigurationProfileResponse`

---

### `PATCH /api/v1/configuration-profiles/{profileId}`

Update a profile. All fields optional (partial update).

**Request Body**: `Partial<CreateConfigurationProfileRequest>`

**Response `200 OK`**: Updated `ConfigurationProfileResponse`

**Side Effect**: Emits MQTT `config/update` payload to all devices in groups assigned this profile, within the current sync cycle.

---

### `DELETE /api/v1/configuration-profiles/{profileId}`

Delete a profile.

**Preconditions**: Cannot delete the system default profile.

**Side Effect**: All `DeviceGroup` records referencing this profile are reassigned to the system default profile. An alert notification is dispatched to all admins.

**Response `204 No Content`**

**Error Responses**:
| Status | Code | Condition |
|--------|------|-----------|
| `409` | `CANNOT_DELETE_DEFAULT` | Attempt to delete the system default profile |

---

## 3. Device Groups

### `POST /api/v1/device-groups`

Create a device group.

**Authorization**: Roles `fleet_admin`, `super_admin`

**Request Body**:
```typescript
interface CreateDeviceGroupRequest {
  name: string;       // Unique. Max 80 chars.
  profileId: string;  // Must reference an existing ConfigurationProfile
}
```

**Response `201 Created`**:
```typescript
interface DeviceGroupResponse {
  groupId: string;
  name: string;
  profileId: string;
  memberCount: number;  // Computed from devices.find({ groupId })
  createdAt: string;
  updatedAt: string;
}
```

---

### `GET /api/v1/device-groups`

List all groups with member counts.

**Response `200 OK`**: `Paginated<DeviceGroupResponse>`

---

### `PATCH /api/v1/device-groups/{groupId}`

Update group name or assigned profile.

**Request Body**: `Partial<CreateDeviceGroupRequest>`

**Response `200 OK`**: Updated `DeviceGroupResponse`

---

### `PATCH /api/v1/device-groups/{groupId}/members`

Move devices into this group (drag-and-drop persistence endpoint). Removes devices from their previous group.

**Request Body**:
```typescript
interface GroupMembershipUpdateRequest {
  deviceIds: string[];    // 1–100 device IDs per request
}
```

**Response `200 OK`**:
```typescript
interface GroupMembershipUpdateResponse {
  groupId: string;
  addedDeviceIds: string[];
  removedFromGroupIds: Record<string, string[]>; // { previousGroupId: [deviceId, ...] }
  triggeredConfigSync: boolean;
}
```

---

### `DELETE /api/v1/device-groups/{groupId}`

Delete a group. Devices in the group become ungrouped (`groupId: null`).

**Response `204 No Content`**

---

## 4. MQTT Contracts

**Source library**: `libs/mqtt-contracts/src/lib/` — add new topic schemas here.

### Topic: `devices/{deviceId}/heartbeat` ← (existing, extended)

The existing heartbeat payload is extended to include health metrics:

```typescript
interface HeartbeatPayload {
  deviceId: string;
  timestamp: string;                  // ISO 8601 (device clock)
  location: {
    lat: number;
    lng: number;
    hdop: number | null;
    locked: boolean;
  };
  // NEW fields:
  health: {
    batteryPercentage: number;
    storageUtilizationPercent: number;
    gpsHdop: number | null;
  };
}
```

### Topic: `devices/{deviceId}/config` → (new, server → device)

Pushed by API when the device's active Configuration Profile changes.

```typescript
interface DeviceConfigPayload {
  profileId: string;
  exhibitionRules: {
    maxLoopLengthSeconds: number;
    adToContentRatio: number;
  };
  connectivityMode: 'Economy' | 'Premium';
  commercialTierMultiplier: number;
  effectiveAt: string;   // ISO 8601 — tablet should apply from this timestamp
}
```

### Topic: `devices/{deviceId}/power-state` ← (new, device → server)

```typescript
interface PowerStatePayload {
  deviceId: string;
  engineOn: boolean;     // true = running, false = ignition off
  voltageV?: number;     // Optional — only present if OBD-II adapter is available
  detectionMethod: 'power_disconnect' | 'obd2_voltage';
  timestamp: string;
}
```

---

## 5. WebSocket / Admin Push Events

Gateway: existing `FleetGateway` (Socket.io) — extend with new event types.

### Event: `device_state_changed`

Broadcast to admin dashboard when any device transitions state.

```typescript
interface DeviceStateChangedEvent {
  type: 'device_state_changed';
  deviceId: string;
  vehicleId: string | null;
  fromState: DeviceLifecycleState;
  toState: DeviceLifecycleState;
  trigger: { type: 'system' | 'admin'; detail: string };
  occurredAt: string;
}
```

### Event: `config_sync_complete`

Broadcast when a profile update has been successfully pushed to all devices in a group.

```typescript
interface ConfigSyncCompleteEvent {
  type: 'config_sync_complete';
  profileId: string;
  groupId: string;
  deviceCount: number;
  syncedAt: string;
}
```
