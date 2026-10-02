# Research: Vehicle lifecycle and device binding

**Feature**: 008-vehicle-device-lifecycle  
**Date**: 2026-04-14

## 1. Current codebase baseline

**Decision**: Treat existing `vehicles` and `devices` collections and NestJS modules as the implementation anchor.

**Rationale**: `Vehicle` already has `vehicleId`, `registrationPlate`, `status`, `boundDeviceId` (single); `Device` has `boundVehicleId`, `lastSeenAt`, `lifecycleState`. This matches the spec’s direction and minimizes greenfield risk.

**Alternatives considered**: New “fleet asset” service separate from vehicles — rejected (YAGNI, duplicates domain).

---

## 2. Plate uniqueness (non-decommissioned only)

**Decision**: Replace the global unique index on `registrationPlate` with a **partial unique index** where `status !== 'decommissioned'` (exact filter expression must match canonical status values in code).

**Rationale**: Spec FR-003; MongoDB supports partial indexes for this pattern.

**Alternatives considered**: Application-only check without index — rejected (race conditions under concurrency).

---

## 3. Multiple devices per vehicle

**Decision**: Migrate from `boundDeviceId` to **`pairedDeviceIds: string[]`** (ordered or unordered; document in data-model). Backfill: existing `boundDeviceId` → single-element array. **`Device.boundVehicleId`** remains **one vehicle** per device; each paired device document points to the same `vehicleId`.

**Rationale**: Matches FR-002 (0–N devices per vehicle, 1 vehicle per device). Sparse unique index on `devices.boundVehicleId` may need adjustment if multiple devices per vehicle (today’s `vehicles.boundDeviceId` unique sparse index becomes invalid for the vehicle side — move uniqueness to device side only).

**Alternatives considered**: Junction collection — deferred unless many-to-many queries become painful.

---

## 4. Roster binding status (worst-case)

**Decision**: Compute **vehicle-level** status in the query layer: load all paired devices’ `lastSeenAt`; if **any** older than 1 hour → hardware-offline (unless vehicle **in shop**); if none paired → hardware-missing; if all fresh → fully operational; **in shop** overrides offline presentation per spec.

**Rationale**: Spec clarification Session 2026-04-14 Q1.

**Alternatives considered**: Store denormalized status on vehicle — optional later for performance; not required for v1.

---

## 5. Vehicle status vs “in shop”

**Decision**: Introduce an explicit flag (e.g. `maintenanceMode: boolean` or `operationalStatus: 'active' | 'maintenance' | 'decommissioned'`) aligned with spec “In Shop” without overloading `inactive` unless product confirms equivalence.

**Rationale**: Current schema has `active | inactive | decommissioned`; spec needs maintenance that suppresses offline alerts.

**Alternatives considered**: Use `inactive` for shop — rejected if inactive has other semantics in campaigns.

---

## 6. Commercial tier and driver

**Decision**: Add **`commercialTier`** (string or enum from product) and **`driver`** reference (e.g. `driverId` nullable FK to users/drivers collection when it exists) or embedded display fields as minimal slice.

**Rationale**: FR-004; map alongside or instead of overloading `fleetCategory` — exact mapping TBD in implementation (may reuse `fleetCategory` temporarily if product agrees).

**Alternatives considered**: Free-text only — acceptable for MVP if enum not finalized.

---

## 7. Audit trail (FR-011)

**Decision**: New append-only collection **`vehicle_binding_audit_events`** (name illustrative) with `action: 'pair' | 'unpair' | 'decommission'`, `actorUserId`, `timestamp`, `vehicleId`, `deviceId?`, correlation id.

**Rationale**: Durable audit separate from Pino logs; queryable for admin UI.

**Alternatives considered**: Rely on logs only — rejected (spec requires reviewable history).

---

## 8. Decommission side effects

**Decision**: Extend `VehicleDecommissionService` to iterate **all** paired devices; for each, clear `boundVehicleId`, set device to unassigned lifecycle state per product rules, enqueue **`CLEAR_CACHE`** (existing `fleet-monitor` remote command) where spec requires cache wipe.

**Rationale**: FR-009; aligns with existing remote command infrastructure.

**Alternatives considered**: MQTT publish ad-hoc — use existing command pipeline for consistency.

---

## 9. Admin API surface for pair/unpair

**Decision**: Add explicit REST endpoints (e.g. `POST /vehicles/:id/pair`, `POST /vehicles/:id/unpair`) with body `{ deviceId }`, guarded by existing `fleet_admin` / `fleet_operator` roles per product matrix; keep tablet-driven **`POST /devices/bind`** for field pairing if still needed, but admin flows should not require rebinding analytics to device UUID.

**Rationale**: Spec administrator workflows; clear separation from device self-registration.

**Alternatives considered**: Pair only via device bind endpoint — insufficient for ops-first “swap hardware” story.

---

## 10. Management UI

**Decision**: Implement roster grid with binding status badges and vehicle detail actions in **`app/openad-management`** using existing patterns (PrimeNG, services to API).

**Rationale**: Spec P3; single admin app in monorepo.

**Alternatives considered**: Separate ops app — out of scope.
