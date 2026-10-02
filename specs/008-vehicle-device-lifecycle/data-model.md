# Data Model: Vehicle lifecycle and device binding

**Feature**: 008-vehicle-device-lifecycle  
**Date**: 2026-04-14  
**Storage**: MongoDB

## Entity relationship

```
Vehicle (1) ──< pairedDeviceIds[] >── (N) Device
     │                                      │
     │                                      └── boundVehicleId → single Vehicle.vehicleId
     └── vehicleId (UUID, PK logical)
```

- A **device** references **at most one** `vehicleId` via `boundVehicleId`.
- A **vehicle** lists **zero or more** `deviceId` values in `pairedDeviceIds`.

## 1. `vehicles` collection (extends existing)

| Field | Type | Notes |
|-------|------|--------|
| `vehicleId` | string (UUID) | Existing primary business key |
| `registrationPlate` | string | Unique among documents where `status !== 'decommissioned'` (partial index) |
| `make`, `model`, `year` | string/number | Existing |
| `status` | enum | Extend: at minimum support **active**, **decommissioned**, and semantics for **in shop / maintenance** (exact enum names TBD to match FR-005) |
| `pairedDeviceIds` | string[] | Bound tablet `deviceId` values (UUID strings); empty when none |
| `commercialTier` | string or enum | FR-004; same values as fleet map filters (`premium` \| `taxi` \| `van` \| `other`) |
| `driverId` | string \| null | **NEW** — optional FK to driver/user entity |
| `operatorId` | string | Existing; single OpenAD operator acceptable |
| `characteristics` | object | Existing |
| `decommissionedAt` | date \| null | Existing |

**Indexes**

- Unique `vehicleId` (existing).
- **Drop** global unique on `registrationPlate` if present; add **partial unique** on `registrationPlate` with partial filter `{ status: { $ne: 'decommissioned' } }` (adjust field name if enum differs).
- Index `{ status: 1 }` for listings.

**State transitions (informal)**

- Create → `active`, `pairedDeviceIds: []`.
- Decommission → `decommissioned`, `decommissionedAt` set, paired devices cleared in tandem with devices collection.

## 2. `devices` collection (extends existing)

| Field | Type | Notes |
|-------|------|--------|
| `deviceId` | string (UUID) | Existing |
| `boundVehicleId` | string \| null | Existing — must match one of parent vehicle’s `pairedDeviceIds` when set |
| `lifecycleState` | enum | Existing — unassigned/assigned semantics aligned with spec “UNASSIGNED” wording in ops |
| `lastSeenAt` | date | Existing — used for offline threshold (1 hour) |
| … | | Other existing fields unchanged |

**Indexes**

- Ensure fast lookup by `boundVehicleId` and `deviceId`.
- Uniqueness of “one device one vehicle” is enforced on the **device** side (`boundVehicleId`) plus application validation for `pairedDeviceIds` consistency.

## 3. `vehicle_binding_audit_events` (new)

Append-only.

| Field | Type | Notes |
|-------|------|--------|
| `eventId` | UUID | PK |
| `action` | `'pair' \| 'unpair' \| 'decommission'` | |
| `vehicleId` | string | |
| `deviceId` | string \| null | Null for decommission-only vehicle-level if applicable |
| `actorUserId` | string | From JWT / `FleetAuditContext` |
| `actorEmail` | string | Optional denormalization for review |
| `correlationId` | string | From request |
| `createdAt` | date | Server time |

**Indexes**: `{ vehicleId: 1, createdAt: -1 }`, `{ deviceId: 1, createdAt: -1 }`, TTL optional (not default — retention by policy).

## 4. Derived: roster `bindingStatus` (not stored)

Enum for API/UI only:

- `fully_operational` | `hardware_missing` | `hardware_offline` | `in_shop`

Derivation per spec worst-case and in-shop override.

## Validation rules (summary)

- **FR-003**: No two vehicles with same `registrationPlate` when both are not decommissioned.
- **FR-002**: Pairing fails if `device.boundVehicleId` already points to another vehicle and not cleared.
- **FR-011**: Every pair/unpair/decommission writes one audit row minimum.
