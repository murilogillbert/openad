# Implementation Plan: Vehicle lifecycle and device binding

**Branch**: `008-vehicle-device-lifecycle` | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/008-vehicle-device-lifecycle/spec.md`

## Summary

Deliver a **decoupled Vehicle ↔ Device** model for OpenAD: vehicles are durable commercial assets; tablets are replaceable hardware. Extend the existing **`vehicles`** and **`devices`** MongoDB collections and NestJS modules (`app/openad-api`) so that:

- Vehicles support **0–N paired devices** (worst-case roster health), **commercial tier**, **driver linkage**, **in-shop** suppression of offline noise, and **plate uniqueness among non-decommissioned** vehicles only.
- **Pair** / **unpair** / **decommission** update both sides consistently, emit **durable audit records** (FR-011), and on decommission trigger **remote commands** (e.g. existing `CLEAR_CACHE` via fleet-monitor) where required.
- **Fleet roster** and management UI (`app/openad-management`) expose binding status semantics from the spec.
- **Management navigation**: the **`/devices`** area uses a **hub shell** (master switcher) so operators choose **Vehicles** (fleet roster + vehicle CRUD entry), **Devices** (tablet inventory / status via a dedicated child route), or **Pairing** (pending tablet pairing), all under one top-level route family. Vehicle workspace (overview / config / diagnostic) lives under **`/devices/vehicles/:vehicleId`**, not a separate `/vehicles` app. See **Management UI route map** below and [tasks.md](./tasks.md) (US3 hub and devices: **T026–T034**, **T042–T043**, **T044–T046**, **T052–T053**).

Technical approach: **`pairedDeviceIds`** on `Vehicle` and `boundVehicleId` on `Device`, aligned with [research.md](./research.md); contracts in [contracts/](./contracts/) and [data-model.md](./data-model.md); Zod contracts mirrored into `libs/api-contracts` during implementation.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20 LTS  
**Primary Dependencies**: Nx, NestJS 11, Mongoose, Angular 21 (management app), Zod (`libs/api-contracts`), JWT auth, MQTT (`app/openad-api` infrastructure)  
**Storage**: MongoDB (`vehicles`, `devices`, new `vehicle_binding_audit_events` or equivalent — see data-model)  
**Testing**: Jest (API/unit), Nx `nx test` / `nx run-many -t test`  
**Target Platform**: Linux API servers; browser admin UI  
**Project Type**: Nx monorepo — API + Angular SPA + shared contracts/domain libs  
**Performance Goals**: Roster list p95 within typical admin expectations; no full-table scans on hot paths (indexed filters)  
**Constraints**: One-hour offline threshold for roster; idempotent decommission  
**Scale/Scope**: Single OpenAD vehicle inventory; many vehicles and devices; audit append-only growth

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with each principle from `.specify/memory/constitution.md`:

- [x] **I. KISS** — Extend existing Vehicle/Device modules and collections; avoid parallel abstractions unless duplication appears.
- [x] **II. DRY** — Single source of truth for binding state in MongoDB; API types from `libs/api-contracts`; domain types from `libs/domain` where shared.
- [x] **III. SOLID** — Services per use case (query, update, pair/unpair, decommission); repositories for persistence.
- [x] **IV. YAGNI** — No multi-tenant fleet partitions; no speculative cross-product features beyond spec.
- [x] **V. TDA** — Pair/unpair/decommission logic co-located in domain services with repositories; avoid controllers owning business rules.
- [x] **VI. TDD** — Tests for uniqueness rules, binding edge cases, audit writes, and roster status derivation before merge.
- [x] **VII. Enterprise Quality** — Structured logging (`FleetAuditContext`), validation, security on JWT routes, versioned API contracts.
- [x] **VIII. Clean Code** — Intention-revealing names (`pairedDeviceIds`, `bindingStatus`).

**Post-design re-check**: Data model and contracts stay within spec; audit and migration paths are explicit — **PASS**.

> No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/008-vehicle-device-lifecycle/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (design-time; mirror to libs/api-contracts in implementation)
└── tasks.md             # Phase 2 (implementation checklist)
```

### Management UI route map (`openad-management`)

| Area | Route | Purpose |
|------|--------|---------|
| Hub (switcher) | `/devices` | Redirects to default child (e.g. `/devices/vehicles`); hosts tab/nav to children + `router-outlet` |
| Vehicles | `/devices/vehicles` | Fleet roster, binding status, vehicle create/edit entry, links into workspace |
| Hardware / tablets | `/devices/hardware` | Tablet-centric list (uses `GET /api/v1/devices` inventory); status + bound vehicle |
| Pairing | `/devices/pairing` | Existing pending-pairing flow; linked from hub |
| Vehicle workspace | `/devices/vehicles/:vehicleId/(overview\|config\|diagnostic)` | Per-vehicle context; UI shows **all paired devices** and per-device stats where applicable |

Legacy bookmarks to **`/devices/:vehicleId`** should redirect to **`/devices/vehicles/:vehicleId`** (SSR routes in `app.routes.server.ts` updated alongside `app.routes.ts`).

### Source Code (repository root)

```text
app/openad-api/src/modules/vehicles/
├── vehicles.schema.ts          # extend: paired devices, tier, driver, maintenance, indexes
├── vehicles.controller.ts       # new routes: pair, unpair, audit list (as needed)
├── vehicles-query.service.ts    # roster + binding status derivation
├── vehicles-update.service.ts
├── vehicle-decommission.service.ts
├── vehicles.repository.ts
└── ...

app/openad-api/src/modules/devices/
├── devices.controller.ts        # add GET list (operator inventory) for /devices/hardware tab
├── devices.schema.ts
├── devices.repository.ts
└── ...

app/openad-api/src/modules/fleet-monitor/
└── remote-command.service.ts    # CLEAR_CACHE on decommission / unpair

libs/api-contracts/src/
├── lib/types.ts                 # Vehicle* types — evolve with Zod schemas
└── vehicles/                    # NEW: zod contracts (implementation phase)

libs/domain/src/lib/
└── entities.ts                  # VehicleStatus, Device types if shared

app/openad-management/src/app/
├── app.routes.ts                # nest hub under path `devices`; children: vehicles, hardware, pairing, vehicles/:vehicleId/...
├── app.routes.server.ts         # SSR segments + redirects for new paths
├── devices/
│   ├── devices-hub.page.ts      # master switcher shell (Vehicles | Devices | Pairing)
│   ├── device-inventory.page.ts # /devices/hardware — tablet list
│   ├── device-workspace.page.ts # vehicle-scoped workspace (param under vehicles/:id)
│   ├── device-overview.page.ts  # multi-device presentation
│   └── ...
├── inventory/
│   ├── inventory.page.ts        # loaded at /devices/vehicles — roster + bind dialog
│   ├── device-bind-dialog.component.ts  # align with vehicle pair API
│   └── ...
└── shared/shell/                # shell-nav.model.ts → `/devices` entry
```

**Structure Decision**: Use existing **`app/openad-api`** `vehicles` and `devices` modules as the integration point; add **`libs/api-contracts`** Zod schemas for new request/response shapes; **`app/openad-management`** implements the **devices hub** plus nested routes above. No new deployable app.

**Naming**: Persist and expose **`commercialTier`** everywhere (API, MongoDB, UI); fleet map filters use the same tier enum ([spec.md](./spec.md) Assumptions).

**Audit (FR-011)**: Persist append-only events (see data-model) **and** expose **GET** list per vehicle for admin UI review; hub/vehicle detail surfaces a read-only audit panel.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
