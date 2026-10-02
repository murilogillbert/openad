# Tasks: Geospatial Intelligence & Triggering Engine

**Input**: Design documents from `/specs/005-geospatial-triggering-engine/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Following TDD (constitution Principle VI), tests are written FIRST before implementation. All test tasks must FAIL before proceeding to implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Include exact file paths in descriptions

## Path Conventions

This is an Nx monorepo with:

- **Backend API**: `app/openad-api/src/`
- **Tablet Client**: `app/openad-ad-client/src/`
- **Management**: `app/openad-management/src/app/`
- **Shared**: `libs/api-contracts/`, `libs/mqtt-contracts/`
- **Feature spec**: `specs/005-geospatial-triggering-engine/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, fixtures, and feature scaffolding so foundational work can start.

- [X] T001 Add geometry dependencies (`@turf/distance` or equivalent) to root `package.json` for circle containment alongside existing `@turf/*` packages
- [X] T002 [P] Create sample GeoJSON fixtures in `app/openad-api/test/fixtures/spatial/sample-polygon.geojson` and `app/openad-api/test/fixtures/spatial/sample-circle.json`
- [X] T003 [P] Create replay coordinate fixtures in `app/openad-ad-client/src/test/fixtures/spatial/replay-route.json`
- [X] T004 [P] Scaffold stub `app/openad-ad-client/src/app/features/geo/services/geofence-monitor.service.ts` exporting injectable service class
- [X] T005 [P] Scaffold stub `app/openad-ad-client/src/app/features/geo/services/spatial-arbitration-engine.service.ts` exporting injectable service class

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared Zod contracts, geometry evaluation, extended zone persistence, and manifest `spatial` emission — required before user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Shared contracts (libs)

- [X] T006 [P] Contract tests for SpatialManifest Zod round-trip in `libs/api-contracts/src/spatial/spatial-manifest.contract.spec.ts`
- [X] T007 Implement `SpatialEntry` and `SpatialManifest` Zod schemas per `specs/005-geospatial-triggering-engine/contracts/spatial-manifest.md` in `libs/api-contracts/src/spatial/spatial-manifest.contract.ts`
- [X] T008 [P] Re-export spatial contracts from `libs/api-contracts/src/index.ts`
- [X] T009 [P] Contract tests for batched ledger payloads in `libs/mqtt-contracts/src/lib/spatial-ledger.contract.spec.ts`
- [X] T010 Implement spatial receipt, residency, and lost-opportunity batch Zod schemas in `libs/mqtt-contracts/src/lib/spatial-ledger.contract.ts`
- [X] T011 [P] Re-export spatial ledger types from `libs/mqtt-contracts/src/index.ts`
- [X] T012 [P] Unit tests for circle and polygon point-in-geometry in `app/openad-api/src/modules/manifest/evaluators/spatial-geometry.util.spec.ts`
- [X] T013 Implement haversine circle and Turf polygon containment in `app/openad-api/src/modules/manifest/evaluators/spatial-geometry.util.ts`

### Geo zone schema and manifest wiring (API)

- [X] T014 Extend discriminated `geometry` (Circle | Polygon), `tier`, `priorityScore`, `bufferExitMeters`, `isActive`, and trigger binding fields on `app/openad-api/src/modules/geo-zones/geo-zone.schema.ts` per `specs/005-geospatial-triggering-engine/data-model.md`
- [X] T015 [P] Add MongoDB indexes for `tier`, `isActive`, and `zoneId` queries in `app/openad-api/src/modules/geo-zones/geo-zone.schema.ts`
- [X] T016 [P] Unit tests for manifest spatial serialization in `app/openad-api/src/modules/manifest/generators/spatial-manifest-builder.service.spec.ts`
- [X] T017 Implement `SpatialManifestBuilderService` mapping active `GeoZone` documents to `SpatialEntry` shapes in `app/openad-api/src/modules/manifest/generators/spatial-manifest-builder.service.ts`
- [X] T018 Inject and call `SpatialManifestBuilderService` from `app/openad-api/src/modules/manifest/generators/manifest-generator.service.ts` to emit additive `spatial` section
- [X] T019 Register `SpatialManifestBuilderService` in `app/openad-api/src/modules/manifest/manifest.module.ts`
- [X] T020 Extend root manifest Zod in `libs/api-contracts/src/media/manifest.contract.ts` with optional `spatial` field validated against `spatial-manifest.contract.ts`

**Checkpoint**: Foundation ready — contracts validate; API can build a manifest containing `spatial.entries` from persisted zones.

---

## Phase 3: User Story 1 — Define spatial zones and commercial rules (Priority: P1) 🎯 MVP

**Goal**: Operators define circle and polygon zones with tiers, priorities, and trigger rules; devices receive a complete spatial manifest without live GPS.

**Independent Test**: Define overlapping zones with different priorities, fetch manifest for a test device profile, and confirm `spatial.entries` includes geometry, trigger modes, rotation, arbitration weights, and creative references.

### Tests for User Story 1 (TDD — write first)

- [X] T021 [P] [US1] Unit tests for extended create/update validation in `app/openad-api/src/modules/geo-zones/geo-zone.service.spec.ts`
- [X] T022 [P] [US1] Integration test asserting manifest includes overlapping zones with distinct `priorityScore` in `app/openad-api/src/test/integration/spatial-manifest.integration.spec.ts`

### Implementation for User Story 1

- [X] T023 [P] [US1] Extend `app/openad-api/src/modules/geo-zones/dto/create-geo-zone.dto.ts` and `app/openad-api/src/modules/geo-zones/dto/list-geo-zones-query.dto.ts` for new geometry union and commercial fields
- [X] T024 [US1] Implement validation and persistence for Circle vs Polygon and trigger bindings in `app/openad-api/src/modules/geo-zones/geo-zone.service.ts`
- [X] T025 [US1] Extend `app/openad-api/src/modules/geo-zones/geo-zones.repository.ts` for filters by `tier`, `isActive`, and geometry type
- [X] T026 [US1] Expose REST endpoints for create/update/list/publish as needed in `app/openad-api/src/modules/geo-zones/geo-zones.controller.ts`
- [X] T027 [P] [US1] Extend map editor for circle tool and polygon editing in `app/openad-management/src/app/geo-zones/geo-zone-map.component.ts`
- [X] T028 [P] [US1] Add zone metadata form (tier, priority score, entry/dwell, rotation, weights) in new or existing component under `app/openad-management/src/app/geo-zones/`
- [X] T029 [US1] Wire HTTP client services in `app/openad-management/src/app/` to send new geo-zone fields to the API
- [X] T030 [US1] Add structured logging for spatial manifest entry counts and build timing in `app/openad-api/src/modules/manifest/generators/spatial-manifest-builder.service.ts`

**Checkpoint**: User Story 1 complete — management can author zones; manifest API returns full `spatial` payload for paired devices.

---

## Phase 4: User Story 2 — Real-time spatial triggering on the vehicle (Priority: P1)

**Goal**: Tablet evaluates cached manifest locally: geofence monitor, entry vs dwell, hysteresis, and peer rotation — without per-fix server calls.

**Independent Test**: Replay or simulate a route; verify dwell does not fire under threshold; entry fires on boundary cross; sequential rotation order holds across eligible events.

### Tests for User Story 2 (TDD — write first)

- [X] T031 [P] [US2] Vitest tests for entry vs dwell and hysteresis in `app/openad-ad-client/src/app/features/geo/services/geofence-monitor.service.spec.ts`
- [X] T032 [P] [US2] Vitest tests for sequential and weighted_random rotation in `app/openad-ad-client/src/app/features/geo/services/spatial-arbitration-engine.service.spec.ts`

### Implementation for User Story 2

- [X] T033 [US2] Implement geofence state machine (inside/outside, dwell timers, exit buffer) in `app/openad-ad-client/src/app/features/geo/services/geofence-monitor.service.ts` using `spatial-geometry` equivalents client-side in `app/openad-ad-client/src/app/features/geo/utils/spatial-geometry.util.ts`
- [X] T034 [US2] Implement rotation strategies (`sequential`, `weighted_random`, `priority_first`) for same-tier peers in `app/openad-ad-client/src/app/features/geo/services/spatial-arbitration-engine.service.ts`
- [X] T035 [US2] Implement `SpatialPlaybackBridgeService` in `app/openad-ad-client/src/app/features/geo/services/spatial-playback-bridge.service.ts` translating eligible creatives to playback intents
- [X] T036 [US2] Extend `app/openad-ad-client/src/app/features/playback/services/playback-engine.service.ts` to accept spatial arbitration output without blocking the UI thread
- [X] T037 [US2] Load and cache `spatial` from device manifest sync flow in `app/openad-ad-client/src/app/features/sync/` (extend existing manifest consumer) so `GeofenceMonitor` reads stable entries
- [X] T038 [US2] Register geo feature providers in `app/openad-ad-client/src/app/app.config.ts` or dedicated `app/openad-ad-client/src/app/features/geo/geo.providers.ts` and import from root bootstrap

**Checkpoint**: User Story 2 complete — tablet triggers locally from cached manifest with entry/dwell and rotation.

---

## Phase 5: User Story 3 — Stable sensing and responsible playback (Priority: P2)

**Goal**: Adaptive polling, smoothing, dead reckoning, and velocity-based gating for triggers and playback.

**Independent Test**: Replay traces with injected noise and GPS dropouts; assert reduced spurious boundary crossings; high-speed silencing engages per manifest policy.

### Tests for User Story 3 (TDD — write first)

- [X] T039 [P] [US3] Unit tests for smoothing and adaptive intervals in `app/openad-ad-client/src/app/features/geo/services/location-pipeline.service.spec.ts`
- [X] T040 [P] [US3] Unit tests for velocity gates in `app/openad-ad-client/src/app/features/geo/services/velocity-gate.util.spec.ts`

### Implementation for User Story 3

- [X] T041 [US3] Implement `LocationPipelineService` with motion-aware sampling bounds in `app/openad-ad-client/src/app/features/geo/services/location-pipeline.service.ts`
- [X] T042 [US3] Add smoothing and dead-reckoning timeout behavior in `app/openad-ad-client/src/app/features/geo/services/location-pipeline.service.ts`
- [X] T043 [US3] Implement velocity evaluation helpers in `app/openad-ad-client/src/app/features/geo/services/velocity-gate.util.ts`
- [X] T044 [US3] Feed smoothed positions from `LocationPipelineService` into `app/openad-ad-client/src/app/features/geo/services/geofence-monitor.service.ts`
- [X] T045 [US3] Apply velocity-based suppression to playback requests in `app/openad-ad-client/src/app/features/geo/services/spatial-playback-bridge.service.ts`

**Checkpoint**: User Story 3 complete — location pipeline reduces jitter and enforces speed policies.

---

## Phase 6: User Story 4 — Geospatial ledger and inventory insight (Priority: P2)

**Goal**: Persist spatial receipts, zone residency intervals, and lost-opportunity events server-side; emit batched telemetry from tablets.

**Independent Test**: After controlled playback and suppressions, query or inspect stored events for receipts, residency totals, and suppression reasons by zone and time window.

### Tests for User Story 4 (TDD — write first)

- [X] T046 [P] [US4] Unit tests for ledger ingest mapping in `app/openad-api/src/modules/spatial-ledger/spatial-ledger-ingest.service.spec.ts`
- [X] T047 [P] [US4] Contract alignment test: MQTT payload validates against `libs/mqtt-contracts/src/lib/spatial-ledger.contract.ts` in `app/openad-api/src/modules/spatial-ledger/spatial-ledger-ingest.service.spec.ts`

### Implementation for User Story 4

- [X] T048 [P] [US4] Create Mongoose schemas `spatial-receipt.schema.ts`, `zone-residency-interval.schema.ts`, `lost-opportunity-event.schema.ts` under `app/openad-api/src/modules/spatial-ledger/schemas/`
- [X] T049 [US4] Implement `SpatialLedgerIngestService` persisting batches in `app/openad-api/src/modules/spatial-ledger/spatial-ledger-ingest.service.ts`
- [X] T050 [US4] Wire MQTT subscription or existing telemetry consumer to call ingest in `app/openad-api/src/modules/spatial-ledger/spatial-ledger.module.ts`
- [X] T051 [US4] Add HTTP fallback routes in `app/openad-api/src/modules/spatial-ledger/spatial-ledger.controller.ts` for batched ingest
- [X] T052 [US4] Add reporting query handler (by `deviceId`, `zoneId`, time range) in `app/openad-api/src/modules/spatial-ledger/spatial-ledger-query.service.ts`
- [X] T053 [US4] Implement `SpatialTelemetryService` in `app/openad-ad-client/src/app/features/geo/services/spatial-telemetry.service.ts` publishing MQTT batches per `spatial-ledger.contract.ts`
- [X] T054 [US4] Register `SpatialLedgerModule` in `app/openad-api/src/app/app.module.ts` (or equivalent root imports)

**Checkpoint**: User Story 4 complete — ledger data lands in MongoDB and is queryable; tablet sends batched events.

---

## Phase 7: User Story 5 — Tiered arbitration and collision handling (Priority: P2)

**Goal**: Tier stack (T1–T4), within-tier scoring (pacing, distance, heading), shadow queue, loop locking, cooldown memory, and lost-opportunity emission when suppressed.

**Independent Test**: Scenario tests with overlapping tiers, mid-play zone entry, and cooldown timers — verify tier precedence, non-emergency loop lock, and cooldown enforcement.

### Tests for User Story 5 (TDD — write first)

- [X] T055 [P] [US5] Unit tests for tier ordering and “no lower tier if higher ready” in `app/openad-ad-client/src/app/features/geo/services/spatial-arbitration-engine.service.spec.ts`
- [X] T056 [P] [US5] Unit tests for scoring terms in `app/openad-ad-client/src/app/features/geo/services/arbitration-score.util.spec.ts`
- [X] T057 [P] [US5] Unit tests for cooldown store in `app/openad-ad-client/src/app/features/geo/services/spatial-cooldown-store.service.spec.ts`
- [X] T058 [P] [US5] Unit tests for shadow queue refresh in `app/openad-ad-client/src/app/features/geo/services/shadow-queue.service.spec.ts`

### Implementation for User Story 5

- [X] T059 [US5] Implement tier gating (T1–T4) in `app/openad-ad-client/src/app/features/geo/services/spatial-arbitration-engine.service.ts`
- [X] T060 [US5] Implement pacing, inverse-distance, and heading score terms in `app/openad-ad-client/src/app/features/geo/services/arbitration-score.util.ts`
- [X] T061 [US5] Implement `ShadowQueueService` trajectory refresh in `app/openad-ad-client/src/app/features/geo/services/shadow-queue.service.ts`
- [X] T062 [US5] Implement loop locking (non-T1 defers interrupt) and Tier-1 emergency interrupt path in `app/openad-ad-client/src/app/features/geo/services/spatial-arbitration-engine.service.ts`
- [X] T063 [US5] Implement IndexedDB-backed `SpatialCooldownStoreService` in `app/openad-ad-client/src/app/features/geo/services/spatial-cooldown-store.service.ts`
- [X] T064 [US5] Integrate cooldown and re-trigger policy with `app/openad-ad-client/src/app/features/geo/services/geofence-monitor.service.ts`
- [X] T065 [US5] Emit lost-opportunity payloads via `app/openad-ad-client/src/app/features/geo/services/spatial-telemetry.service.ts` when arbitration suppresses a candidate

**Checkpoint**: User Story 5 complete — full arbitration stack matches spec FR-016–FR-019.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Observability, security, E2E smoke, and quickstart validation.

- [X] T066 [P] Add Prometheus or existing metrics hook for spatial manifest build duration in `app/openad-api/src/modules/manifest/generators/manifest-generator.service.ts`
- [X] T067 [P] Add tablet metrics for geofence evaluation loop timing in `app/openad-ad-client/src/app/features/geo/services/geofence-monitor.service.ts`
- [X] T068 Verify JWT authz for mutating geo-zone routes in `app/openad-api/src/modules/geo-zones/geo-zones.controller.ts`
- [X] T069 [P] Playwright smoke: create zone and assert API response in `app/openad-management-e2e/src/spatial-zones.spec.ts`
- [ ] T070 Run manual validation steps from `specs/005-geospatial-triggering-engine/quickstart.md` against local stack

### Supplemental (previously implicit; implemented 2026-04-05)

- [X] T071 Wire `DeviceInfoService` location → `GeofenceMonitorService.evaluatePosition` → `SpatialPlaybackBridgeService` via `app/openad-ad-client/src/app/features/geo/services/spatial-runtime.service.ts` and `APP_INITIALIZER` in `app/openad-ad-client/src/app/app.config.ts` (idempotent `DeviceInfoService.start()`)
- [X] T072 Hysteresis exit buffer (FR-010): `withinExpandedGeometry` in `app/openad-ad-client/src/app/features/geo/utils/spatial-geometry.util.ts` and `hysteresisExitMeters` on `SpatialEntry` in `app/openad-ad-client/src/app/features/geo/services/geofence-monitor.service.ts`

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user stories**
- **Phases 3–7 (US1–US5)**: Depend on Phase 2; see user story dependencies below
- **Phase 8 (Polish)**: Depends on desired user stories being complete (minimum US1–US2 for a coherent demo)

### User story completion order (recommended)

```text
Foundational → US1 (zones + manifest) → US2 (edge engine + playback hook)
    → US3 (location pipeline) feeds US2
    → US4 (ledger) can start after US2 has telemetry hooks; full value after US5 lost-opportunity
    → US5 (tiers, scoring, shadow, cooldown) extends US2 arbitration
```

- **US1**: Depends on Foundational only — **MVP core**
- **US2**: Depends on US1 (manifest content) and Foundational
- **US3**: Depends on US2 (monitor consumes positions)
- **US4**: Depends on Foundational; **full** receipts/lost-opportunity alignment depends on US5 for suppression reasons
- **US5**: Depends on US2 (arbitration shell) — refines same services

### Parallel opportunities

- Phase 1 tasks **T002–T005** marked [P] — different files
- Phase 2 contract tasks **T006–T012** and **T015–T016** — parallelizable after directories exist
- Within US1, **T021–T023** and **T027–T028** — parallel tests and UI
- Within US2, **T031–T032** — parallel Vitest suites
- US3 **T039–T040**; US4 **T046–T048**; US5 **T055–T058** — parallel test files
- Phase 8 **T066–T067** and **T069** — parallel

### Parallel example: User Story 1

```bash
# Tests first (parallel):
pnpm exec nx run openad-api:test --testPathPattern=geo-zone.service.spec
pnpm exec nx run openad-api:test --testPathPattern=spatial-manifest.integration

# UI parallel:
# Edit geo-zone-map.component.ts and zone form component concurrently (different files)
```

### Parallel example: User Story 5

```bash
pnpm exec nx run openad-ad-client:test --testPathPattern=spatial-arbitration-engine
pnpm exec nx run openad-ad-client:test --testPathPattern=arbitration-score.util
pnpm exec nx run openad-ad-client:test --testPathPattern=spatial-cooldown-store
pnpm exec nx run openad-ad-client:test --testPathPattern=shadow-queue
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 — zones + spatial manifest end-to-end
4. **Stop and validate**: Manifest contains overlapping zones and commercial rules per independent test
5. Demo or deploy preview

### Incremental delivery

1. Setup + Foundational → shared contracts and manifest `spatial` emission
2. US1 → operators can author zones; devices receive manifest (**MVP**)
3. US2 → in-vehicle triggering without server-per-fix
4. US3 → stable GPS and velocity policy
5. US4 → accountability and inventory telemetry
6. US5 → production-grade arbitration and fairness

### Suggested MVP scope

- **Phases 1–3 (through US1)** deliver the first shippable increment: authoritative zones and distributable spatial rules without requiring the full tablet engine.

---

## Notes

- [P] tasks use different files or isolated test modules — avoid merge conflicts
- [USn] labels apply only to user story phases (3–7)
- Re-run failing tests after each checkpoint; keep spatial manifest additive for legacy clients (`spatial.version` per contract)
- Performance: profile manifest build if `spatial.entries` exceeds ~200 (plan.md)
