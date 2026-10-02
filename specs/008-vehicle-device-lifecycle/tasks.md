---
description: "Task list for 008 vehicle lifecycle and device binding"
---

# Tasks: Vehicle lifecycle and device binding

**Input**: Design documents from `/home/bode/Documents/repos/openad-monorepo/specs/008-vehicle-device-lifecycle/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md), [research.md](./research.md), [contracts/](./contracts/)

**Tests**: Included per OpenAD Constitution (TDD): failing tests before implementation for new services where practical.

**Organization**: Phases follow user story priorities P1–P4 from [spec.md](./spec.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency on incomplete sibling)
- **[Story]**: [US1]–[US4] for user-story phases only

## Path Conventions (this monorepo)

- API: `app/openad-api/src/modules/vehicles/`, `app/openad-api/src/modules/devices/`, `app/openad-api/src/modules/fleet-monitor/`
- Contracts: `libs/api-contracts/src/`
- Domain: `libs/domain/src/lib/`
- Admin UI: `app/openad-management/src/app/inventory/`, `app/openad-management/src/app/devices/` (hub shell, workspace, device inventory tab)

---

## Phase 1: Setup (shared contracts & types)

**Purpose**: Shared types and Zod contracts so API and Angular stay aligned.

- [x] T001 Add `libs/api-contracts/src/vehicles/vehicle-lifecycle.contract.ts` mirroring `specs/008-vehicle-device-lifecycle/contracts/vehicle-lifecycle.contract.ts` and export from `libs/api-contracts/src/index.ts`
- [x] T002 [P] Extend `libs/api-contracts/src/lib/types.ts` with `VehicleListItem`, `VehicleDetailResponse`, and related shapes for `pairedDeviceIds`, `bindingStatus`, **`commercialTier`**, `driverId`, and binding-audit list types as per [data-model.md](./data-model.md)
- [x] T003 [P] Align shared enums/types in `libs/domain/src/lib/entities.ts` (e.g. vehicle operational/maintenance/decommissioned) with `app/openad-api/src/modules/vehicles/vehicles.schema.ts` changes

---

## Phase 2: Foundational (blocking — schema, migration, audit plumbing)

**Purpose**: MongoDB shapes, indexes, backfill, and audit persistence **before** story endpoints.

**⚠️ CRITICAL**: No user story work until this phase completes.

- [x] T004 Extend `app/openad-api/src/modules/vehicles/vehicles.schema.ts` with `pairedDeviceIds`, `commercialTier`, `driverId`, maintenance/in-shop representation; replace global unique `registrationPlate` index with **partial unique** index for non-decommissioned vehicles per [research.md](./research.md)
- [x] T005 Create `app/openad-api/src/modules/vehicles/vehicle-binding-audit.schema.ts`, `vehicle-binding-audit.repository.ts`, and register in `app/openad-api/src/modules/vehicles/vehicles.module.ts`
- [x] T006 [P] Ensure test seeds (`test-app.factory`, fixtures) and any scripts create vehicles with `pairedDeviceIds` + `commercialTier` only (no legacy fields)
- [x] T007 Update `app/openad-api/src/modules/vehicles/vehicles.repository.ts` for `pairedDeviceIds`, plate uniqueness queries, and list filters needed by stories
- [x] T008 Update `app/openad-api/src/modules/devices/devices.repository.ts` (and `devices.schema.ts` if needed) for consistent `boundVehicleId` / `lifecycleState` updates when pairing multiple devices to one vehicle
- [x] T009 Add `app/openad-api/src/modules/vehicles/vehicle-binding-audit.service.ts` to append FR-011 audit documents using `FleetAuditContext` from `app/openad-api/src/infrastructure/logging/fleet-audit.context.ts`

**Checkpoint**: Schema + migration + audit write path ready — user stories can start.

---

## Phase 3: User Story 1 — Swap hardware without losing history (Priority: P1) 🎯 MVP

**Goal**: Admin **pair** / **unpair** updates vehicle device set and device rows; durable audit; vehicle-scoped analytics unchanged.

**Independent Test**: Pair then unpair devices on a test vehicle; vehicle id stable; audit entries exist; device `boundVehicleId` and lifecycle consistent.

### Tests (TDD)

- [x] T010 [P] [US1] Add failing Jest tests in `app/openad-api/src/modules/vehicles/vehicle-binding.service.spec.ts` covering happy path, duplicate pair, pair device already bound elsewhere, audit rows

### Implementation

- [x] T011 [US1] Implement `app/openad-api/src/modules/vehicles/vehicle-binding.service.ts` (pair/unpair transactions: update `vehicles.pairedDeviceIds` and `devices.boundVehicleId` / lifecycle per product rules; call `VehicleBindingAuditService`)
- [x] T012 [US1] Add `pair-vehicle.dto.ts`, `unpair-vehicle.dto.ts`, and `POST` routes on `app/openad-api/src/modules/vehicles/vehicles.controller.ts` with `JwtAuthGuard` / `RolesGuard` consistent with existing vehicle routes
- [x] T013 [US1] Make T010 tests pass; ensure logging uses structured `FleetAuditContext` on pair/unpair code paths

### Audit read API (FR-011 review path)

- [x] T042 [P] [US1] Add failing Jest tests in `app/openad-api/src/modules/vehicles/vehicle-binding-audit-query.service.spec.ts` for paginated listing of binding events filtered by `vehicleId` (and optional `deviceId`)
- [x] T043 [US1] Implement `vehicle-binding-audit-query.service.ts`, register in `vehicles.module.ts`, and expose `GET /api/v1/vehicles/:vehicleId/binding-audit` on `vehicles.controller.ts` with Zod/list DTOs in `libs/api-contracts`; reuse `RolesGuard` roles consistent with `GET /vehicles/:vehicleId`

**Checkpoint**: User Story 1 complete — hardware swap API usable; **pair/unpair** audited and **listable** for review.

---

## Phase 4: User Story 2 — Onboard vehicle before tablet (Priority: P2)

**Goal**: Create vehicle with plate/tier/driver; reject duplicate plates among non-decommissioned; empty paired set.

**Independent Test**: `POST` vehicle succeeds; second active same plate fails; after decommission, reuse plate succeeds.

### Tests (TDD)

- [x] T014 [P] [US2] Add failing Jest tests in `app/openad-api/src/modules/vehicles/vehicles-create.service.spec.ts` for duplicate plate and successful create

### Implementation

- [x] T015 [US2] Add `create-vehicle.dto.ts`, `VehiclesCreateService` in `app/openad-api/src/modules/vehicles/vehicles-create.service.ts`, and `POST` handler in `vehicles.controller.ts` with validation against FR-003/FR-004

**Checkpoint**: User Story 2 complete — onboarding API matches spec.

---

## Phase 4b: Vehicle maintenance / in-shop (API — blocks roster semantics)

**Purpose**: FR-005 “in shop” suppression requires a persisted flag from **T004** and an operator **PATCH** before **T017** can treat maintenance correctly.

- [x] T047 [US3] Extend `app/openad-api/src/modules/vehicles/vehicles-update.service.ts`, `dto/update-vehicle.dto.ts`, and `PATCH /api/v1/vehicles/:vehicleId` in `vehicles.controller.ts` for **maintenance / in-shop** fields (names aligned with `vehicles.schema.ts` from T004); add `vehicles-update.service.spec.ts` coverage for toggle and validation

---

## Phase 5: User Story 3 — Fleet roster, devices hub, & binding status (Priority: P3)

**Goal**: (1) API list/detail return **bindingStatus** (worst-case device health, 1h offline, in-shop override). (2) **Management `/devices`** becomes a **hub** with a master switcher so operators choose **Vehicles** (fleet CRUD + roster) vs **Devices** (tablet inventory / status) vs **Pairing** (tablet pairing queue), all under the same top-level route. (3) Vehicle workspace and device overview reflect **multi-device** pairing and updated stats; tablet pairing dialog flows use vehicle-centric pair APIs where applicable.

**Independent Test**: Hub shows three areas; URLs resolve; seeded devices yield correct `bindingStatus`; device tab lists tablets; pairing still works; workspace shows all paired tablets for a vehicle.

### Tests (TDD) — API

- [x] T016 [P] [US3] Add failing unit tests for binding-status derivation (extract pure helper in `app/openad-api/src/modules/vehicles/vehicle-binding-status.util.ts` if needed) in `app/openad-api/src/modules/vehicles/vehicle-binding-status.util.spec.ts`; **document in file header** the rule for **missing/ambiguous device heartbeat** (treat as offline for roster — [spec.md](./spec.md) edge case)

### Implementation — API roster & device inventory

- [x] T017 [US3] Extend `app/openad-api/src/modules/vehicles/vehicles-query.service.ts` (and `vehicle-list-query.dto.ts` if needed) to populate `bindingStatus`, `pairedDeviceIds`, and device freshness from `devices` + `fleet-status` data as available
- [x] T026 [US3] Add operator **paginated device inventory** `GET /api/v1/devices` (query + index) in `app/openad-api/src/modules/devices/devices.controller.ts` with list DTOs, using `DevicesRepository` / new query helper; expose bound vehicle summary (`boundVehicleId`, plate if joined); add Jest coverage in `app/openad-api/src/modules/devices/devices-list.service.spec.ts` or equivalent; extend `libs/api-contracts` types

### Tests (TDD) — Angular hub (before hub implementation)

- [x] T027 [P] [US3] Add failing `app/openad-management/src/app/devices/devices-hub.page.spec.ts` — asserts tab links for Vehicles, Devices (hardware), and Pairing, and a `router-outlet`

### Implementation — Devices hub shell & routing (do before T018–T019)

- [x] T028 [US3] Create `app/openad-management/src/app/devices/devices-hub.page.ts` + `devices-hub.page.html` (+ optional `.css`) — master switcher UI (`routerLink` to child routes), page title/context for operators; export standalone component
- [x] T029 [US3] Refactor `app/openad-management/src/app/app.routes.ts`: under `path: 'devices'`, use **hub** as parent with `children`: default redirect to `vehicles`; `path: 'vehicles'` → existing `InventoryPage` (fleet roster + vehicle CRUD entry); `path: 'hardware'` → new device inventory page (T031); `path: 'pairing'` → existing `PendingPairingComponent`; nest `path: 'vehicles/:vehicleId'` → `DeviceWorkspacePage` with existing `overview` / `config` / `diagnostic` children. Remove ambiguity with `pairing` before param routes.
- [x] T030 [US3] Update `app/openad-management/src/app/app.routes.server.ts` for new segments (`devices/vehicles/:vehicleId/...`, hub children); add **legacy redirects** if needed from old `devices/:vehicleId` → `devices/vehicles/:vehicleId` for bookmarks

### Tests (TDD) — Angular device inventory & overview (**before** T031 / T033 — Constitution VI)

- [x] T044 [P] [US3] Add failing `app/openad-management/src/app/devices/device-inventory.page.spec.ts` with minimal template assertions (table/host binding) **before** implementing T031
- [x] T045 [P] [US3] Add failing `app/openad-management/src/app/devices/device-overview.page.spec.ts` (and/or `device-workspace.page.spec.ts`) for multi-device header placeholders **before** implementing T033

- [x] T031 [US3] Add `app/openad-management/src/app/devices/device-inventory.page.ts` (+ template) — **Devices** tab: table of tablets from **T026** API, lifecycle/last seen/bound vehicle; navigation to `devices/vehicles/:vehicleId/overview` for bound vehicle context — **make T044 pass**
- [x] T032 [US3] Update cross-app links: `app/openad-management/src/app/shared/shell/shell-nav.model.ts` (keep nav to `/devices` → hub default), `device-workspace.page.ts` `backToFleet()` → `/devices/vehicles`, `pages/inventory.page.ts` `onViewVehicle` → `/devices/vehicles/:vehicleId/overview`, `pages/fleet-map.page.ts` device navigation, and any other `router.navigate(['/devices', ...])` call sites

### Implementation — Workspace & pairing UX (multi-device + vehicle-centric pair)

- [x] T033 [US3] Update `app/openad-management/src/app/devices/device-workspace.page.html` + `device-overview.page.ts` (+ related templates) to present **all paired devices** (from `VehicleDetailResponse.pairedDeviceIds` / nested device summaries), per-device **last seen** / health, and aggregate vehicle context — adjust copy so “Device” sections reflect worst-case or per-screen stats per spec — **make T045 pass**
- [x] T034 [US3] Refactor `app/openad-management/src/app/inventory/device-bind-dialog.component.ts` (and `inventory.service.ts` methods) to use **vehicle pair** endpoints from **T012** when binding an unassigned tablet to a selected vehicle; align success/refresh with hub + **T031** device list + vehicle list refresh

### Implementation — Roster list & vehicle detail (after hub routes exist)

- [x] T018 [US3] **Depends on T028–T030.** Update `app/openad-management/src/app/inventory/inventory.service.ts` and `app/openad-management/src/app/inventory/inventory-list.component.ts` for binding status badges/columns from **T017** API; ensure list is only loaded under hub **`/devices/vehicles`** (no duplicate fetches breaking SSR)
- [x] T019 [US3] **Depends on T033–T034, T047.** Update `app/openad-management/src/app/inventory/vehicle-detail/vehicle-detail.component.ts` for multi-device, decommission, **maintenance/in-shop** controls (calling PATCH from **T047**), and navigation under **`/devices/vehicles/...`**; pair/unpair actions wired to **T012** where applicable

### Audit review UI (FR-011)

- [x] T052 [US3] **Depends on T043.** Add failing test stub in `vehicle-detail.component.spec.ts` or new `vehicle-binding-audit-panel.component.spec.ts` expecting an audit section when events exist
- [x] T053 [US3] Implement read-only **binding audit** panel (table or timeline) in `vehicle-detail.component.ts` / template (or small child component) fed by `GET .../binding-audit` via `InventoryService`/`HttpClient`; **make T052 pass**

### Angular tests — green + refactor (Constitution VI)

- [x] T046 [P] [US3] Expand `devices-hub.page.spec.ts`, **T044**, **T045**, **T052** coverage for routing stubs, **InventoryService** refresh, and audit panel happy path; refactor duplicated test setup

**Checkpoint**: User Story 3 complete — operators use **one `/devices` hub** to switch Vehicles vs Devices vs Pairing; roster and device screens match spec; **audit history** readable in UI; pairing flows coherent.

---

## Phase 6: User Story 4 — Decommission without erasing history (Priority: P4)

**Goal**: Soft decommission; unpair all devices; remote **CLEAR_CACHE**; audit; remove from active map/forecast integrations.

**Independent Test**: Decommission vehicle with two paired devices — both unpaired, audit entry, commands issued per policy.

### Tests (TDD)

- [x] T036 [P] [US4] Add failing Jest tests in `app/openad-api/src/modules/vehicles/vehicle-decommission.service.spec.ts` for multi-device unpair and audit

### Implementation

- [x] T037 [US4] Refactor `app/openad-api/src/modules/vehicles/vehicle-decommission.service.ts` to iterate `pairedDeviceIds`, update devices with correct `lifecycleState`, invoke `app/openad-api/src/modules/fleet-monitor/remote-command.service.ts` (or existing issue-command flow) for `CLEAR_CACHE` per [research.md](./research.md), write decommission audit via `VehicleBindingAuditService`; ensure decommission from **vehicle detail** (T019) still navigates correctly under hub; preserve/emit `FleetDomainEventsService` / `affectedCampaigns` behavior for downstream consumers
- [x] T038 [US4] Fix any stale references to `boundDeviceId` / device `status` vs `lifecycleState` in decommission path for consistency with `devices.schema.ts`
- [x] T048 [US4] **FR-009 map/forecast:** Verify **live map** and **fleet snapshot** queries exclude vehicles with `status === 'decommissioned'` (and devices unbound); add regression test in `fleet-monitor` / `vehicles-query` / map snapshot builder as appropriate, or document assertion in `vehicle-decommission.service.spec.ts` with integration follow-up
- [x] T049 [US4] **FR-009 forecasting:** Confirm schedule-rule / campaign **forecasting** paths do not count decommissioned vehicles (zone/campaign linkage already partially handled via `affectedCampaigns` in decommission); add test or explicit filter in consumer if gap found; cross-link in code comment from `vehicle-decommission.service.ts`

**Checkpoint**: User Story 4 complete — decommission matches FR-009/FR-011 including **non-participation** in live maps and active forecasting surfaces.

---

## Phase 7: Polish & cross-cutting

**Purpose**: Lint, docs, regression safety across stories (including **/devices** hub SSR, deep links, **FR-008**).

- [x] T039 [P] Run and fix `pnpm exec nx run openad-api:lint` and `pnpm exec nx run openad-management:lint`
- [x] T040 [P] Run `pnpm exec nx run openad-api:test` and `pnpm exec nx run openad-management:test`; address failures (including **T027**, **T044–T046**, **T052**, hub routing, audit query **T043**)
- [x] T041 Align `specs/008-vehicle-device-lifecycle/quickstart.md` with actual routes (`/devices/vehicles`, `/devices/hardware`, `/devices/pairing`, workspace URLs), **`GET /api/v1/vehicles/:vehicleId/binding-audit`**, and env vars after implementation
- [x] T050 [P] **FR-008 regression:** Add or extend a test in `app/openad-api` (e.g. `impressions` / `analytics` / contract spec) asserting **playback or impression records** remain keyed by **`vehicleId`** (not device id as the durable business key); document that hardware swap does not fork vehicle-scoped series
- [x] T051 [P] **SC-002 spot-check:** Manual or lightweight E2E note in PR checklist — vehicle create under 5 minutes with known fields (timing optional in CI); duplicate-plate rejection covered by **T014**/**T015**

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1** → no prerequisites.
- **Phase 2** → depends on Phase 1 (types/contracts inform DTOs).
- **Phase 3–6** → depend on Phase 2 completion.
- **Phase 7** → after desired user stories complete (full hub + API).

### User story dependencies

| Story | Depends on | Notes |
|-------|------------|--------|
| US1 (P1) | Phase 2 | Core binding + audit |
| US2 (P2) | Phase 2 | Can parallel with US1 after T004–T007 if staffed (plate logic touches same files — prefer sequential T015 after T011 or coordinate) |
| US3 (P3) | Phase 2; after US1 recommended | Query + **hub UI**; run **T026–T030** before **T018–T019**; device list API (**T026**) can parallel with **T016–T017** |
| US4 (P4) | Phase 2; US1 + US3 vehicle APIs stable | Decommission + hub vehicle detail |

**Suggested sequencing for single developer**: Phase 1 → Phase 2 → US1 (**T010–T013**, **T042–T043**) → US2 → **T047** (maintenance PATCH) → US3 API (**T016–T017**, **T026**) → US3 hub (**T027–T030**, **T044–T045** before **T031**/**T033**) → US3 workspace/pairing (**T033–T034**) → US3 roster/detail (**T018–T019**, **T052–T053**, **T046**) → US4 (**T036–T038**, **T048–T049**) → Polish (**T039–T041**, **T050–T051**).

### Parallel opportunities

- **T002** and **T003** can run in parallel after **T001**.
- **T016** and **T026** (API binding math vs device list endpoint) can run in parallel after **T008** once repository patterns exist.
- **T027** (failing hub tests) can start in parallel with **T026**–**T017**.
- **T042**–**T043** can parallel with late US1 polish if audit collection exists (**T005**/**T009**).
- **T018** and **T019** can run in parallel **after T030** (different components; shared types from **T002**/**T017**).

---

## Parallel example: User Story 1 (after Phase 2)

```bash
# Sequential: T010 tests → T011 service → T012 controller → T013 logging
```

## Parallel example: User Story 3 (after T017 + hub)

```bash
# After T030: T018 inventory-list and T019 vehicle-detail in parallel (coordinate with T033/T034 if same PR)
# T031 device-inventory page can parallel T032 nav updates if routes merged first
```

---

## Implementation strategy

### MVP first (User Story 1 only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Stop and validate pair/unpair + audit independently.

### Incremental delivery

1. US1 → US2 → US3 (API + hub + workspace) → US4 → Polish — **hub (T028–T030)** should land before or with roster UI refresh (**T018–T019**) so operators never lose `/devices` entry.

### Task counts

| Phase | Task IDs | Count |
|-------|-----------|-------|
| Phase 1 | T001–T003 | 3 |
| Phase 2 | T004–T009 | 6 |
| US1 | T010–T013, T042–T043 | 6 |
| US2 | T014–T015 | 2 |
| Phase 4b | T047 | 1 |
| US3 | T016–T019, T026–T034, T044–T045, T052–T053, T046 | 22 |
| US4 | T036–T038, T048–T049 | 5 |
| Polish | T039–T041, T050–T051 | 5 |
| **Total** | **46** checklist items (IDs **T001–T053**, non-contiguous — see execution index) | **46** |

---

## Execution order index (numeric sequence for implementers)

Execute in this order when in doubt (IDs are **not** sorted numerically in the document):

`T001`–`T003` → `T004`–`T009` → `T010`–`T013` → `T042`–`T043` → `T014`–`T015` → `T047` → `T016`–`T017` → `T026` → `T027`–`T030` → `T044`–`T045` → `T031`–`T032` → `T033`–`T034` → `T018`–`T019` → `T052`–`T053` → `T046` → `T036`–`T038` → `T048`–`T049` → `T039`–`T041` → `T050`–`T051`

---

## Notes

- Every task line uses the checklist format with **Task ID** and **file path(s)**.
- [P] marks parallelizable tasks within constraints above.
- **ID order**: US3 uses **T016–T019** interleaved with **T026–T034** and **T042+** — follow **Execution order index** and **Suggested sequencing**, not raw numeric sort.
- Coordinate **T018/T019** with **T017** and complete **T028–T030** so URLs under `/devices/vehicles` work before merging list/detail PRs.
- Tablet **pairing** remains at **`/devices/pairing`** but is linked from the **hub** switcher (**T028**).
- **T044/T045** MUST precede **T031/T033** implementation (TDD).
