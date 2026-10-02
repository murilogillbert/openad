# Tasks: Analytics & Reconciliation Engine

**Input**: Design documents from `/specs/006-analytics-reconciliation/`  
**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `research.md`, `contracts/`, `quickstart.md`

**Tests**: Per `.specify/memory/constitution.md` **§VI (TDD)**, write failing tests **before** implementation for each user story that lists test tasks. Stories without a dedicated test subsection still require tests added in the same phase before merge (extend adjacent `*.spec.ts` files). No story ships without automated coverage appropriate to its risk.

**Organization**: Tasks are grouped by user story so each increment can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependencies)
- **[Story]**: User story label (`US1`–`US5`) for story-phase tasks only
- Every task includes a concrete file path

## Path Conventions (this monorepo)

- Shared contracts: `libs/api-contracts/src/`
- API: `app/openad-api/src/`
- Tablet: `app/openad-ad-client/src/app/features/`
- Management UI: `app/openad-management/src/app/`

---

## Phase 1: Setup (shared contracts)

**Purpose**: Establish analytics contract surface in `api-contracts` before API or tablet work.

- [x] T001 Create `libs/api-contracts/src/analytics/` with `libs/api-contracts/src/analytics/index.ts` and export analytics from `libs/api-contracts/src/index.ts`
- [x] T002 [P] Implement Zod schemas and TypeScript types for play records and gzip batch envelope per `specs/006-analytics-reconciliation/contracts/playback-play-record.md` in `libs/api-contracts/src/analytics/playback-play-record.contract.ts`

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Mongo schema, queue registration, and module shell so all user stories can attach to the same primitives.

**⚠️ CRITICAL**: No user story work should start until this phase completes (except parallel work on T001–T002 if already merged).

- [x] T003 Create Mongoose schema for `play_records` per `data-model.md` in `app/openad-api/src/modules/analytics/schemas/play-record.schema.ts`
- [x] T004 [P] Add queue name constant in `app/openad-api/src/modules/analytics/constants/analytics-queue.constants.ts`
- [x] T005 Register BullMQ queue `analytics-reconciliation` in `app/openad-api/src/infrastructure/queues/queues.module.ts` and add minimal `@Processor('analytics-reconciliation')` stub in `app/openad-api/src/modules/analytics/processors/analytics-reconciliation.processor.ts`
- [x] T006 Create `AnalyticsModule` wiring Mongoose, `BullModule.registerQueue`, and processor provider in `app/openad-api/src/modules/analytics/analytics.module.ts`
- [x] T007 Register `AnalyticsModule` in `app/openad-api/src/app/app.module.ts` and `app/openad-api/src/test/test-app.module.ts`
- [x] T008 [P] Add analytics-related env keys (e.g. ingest body limits, fraud thresholds) to `app/openad-api/src/app/env.validation.ts`

**Checkpoint**: API boots with `AnalyticsModule`; queue registered; processor no-ops safely.

---

## Phase 3: User Story 1 — Ingest high-fidelity playback events (Priority: P1) — MVP

**Goal**: Edge buffers plays; core accepts gzipped batches, validates, persists immutable play rows, and defers heavy work via the queue.

**Independent Test**: Simulate or replay batched uploads; each accepted play is stored once with required fields; ingest handler returns after enqueue, not after full reconciliation.

### Tests for User Story 1

> Write these first where TDD is enforced; they should fail until implementation lands.

- [x] T009 [P] [US1] Unit tests for Zod round-trip and batch envelope in `libs/api-contracts/src/analytics/playback-play-record.contract.spec.ts`
- [x] T010 [P] [US1] Integration test: POST gzip batch → job queued → documents inserted in `app/openad-api/src/test/integration/analytics-playback-batch-ingest.integration.spec.ts`

### Implementation for User Story 1

- [x] T011 [US1] Implement `PlaybackBatchIngestService` (parse gzip, validate, enqueue) in `app/openad-api/src/modules/analytics/services/playback-batch-ingest.service.ts`
- [x] T012 [US1] Implement `PlaybackBatchController` (device-authenticated POST, streaming gzip) in `app/openad-api/src/modules/analytics/playback-batch.controller.ts`
- [x] T013 [US1] Extend `app/openad-api/src/modules/analytics/processors/analytics-reconciliation.processor.ts` to insert raw `play_records` with `reconciliationStatus: pending` and idempotent `(deviceId, uniqueEventId)` handling
- [x] T014 [P] [US1] Implement SQLite tables `pending_plays` and `outbound_batches` per `data-model.md` in `app/openad-ad-client/src/app/features/analytics/services/play-record-buffer.service.ts`
- [x] T015 [US1] Implement gzip batch build, POST with retry/backoff, connectivity/load-aware **deferral** of flush (FR-004), and mark uploaded in `app/openad-ad-client/src/app/features/analytics/services/play-batch-uploader.service.ts`
- [x] T016 [US1] On play completion, enqueue a buffered play record in `app/openad-ad-client/src/app/features/playback/services/playback-engine.service.ts`
- [x] T017 [US1] Create `app/openad-ad-client/src/app/features/analytics/analytics.module.ts` providing buffer + uploader; import `AnalyticsModule` in `app/openad-ad-client/src/app/app.config.ts` alongside `PlaybackModule`
- [x] T018 [US1] Return **per-record** accept/reject outcomes for partial batch failures (edge case in `spec.md`) via response DTO and/or structured logs in `app/openad-api/src/modules/analytics/playback-batch.controller.ts` and `app/openad-api/src/modules/analytics/services/playback-batch-ingest.service.ts`

**Checkpoint**: End-to-end smoke per `specs/006-analytics-reconciliation/quickstart.md` (ingest + tablet buffer path).

---

## Phase 4: User Story 2 — Reconcile plays for billing integrity (Priority: P2)

**Goal**: Classify plays as billable, partial, duplicate, or geofence-failed; update `play_records` and `billable` flags.

**Independent Test**: Duplicate logical plays, partial durations, and geofence trigger mismatches produce expected `reconciliationStatus` values.

### Tests for User Story 2

- [x] T019 [P] [US2] Unit tests for dedupe, partial duration, and geofence branch in `app/openad-api/src/modules/analytics/services/reconciliation.service.spec.ts`

### Implementation for User Story 2

- [x] T020 [US2] Implement `ReconciliationService` with dedupe by `(deviceId, uniqueEventId)`, partial vs asset duration, and status updates in `app/openad-api/src/modules/analytics/services/reconciliation.service.ts`
- [x] T021 [US2] For `triggerReason` geofence-related plays, verify start/end coordinates against campaign geo rules using `app/openad-api/src/modules/geo-zones/geo-zones.repository.ts` (or dedicated helper) from `reconciliation.service.ts`
- [x] T022 [US2] Split processor flow: after raw insert, enqueue or inline-call reconciliation stage; keep ingest path non-blocking in `app/openad-api/src/modules/analytics/processors/analytics-reconciliation.processor.ts`
- [x] T023 [P] [US2] Add integration test overlapping batches in `app/openad-api/src/test/integration/analytics-reconciliation.integration.spec.ts`

**Checkpoint**: Duplicate and partial plays excluded from `billable`; geofence inconsistencies flagged per spec.

---

## Phase 5: User Story 3 — Commercial metrics for the management experience (Priority: P3)

**Goal**: Management users see impressions, reach, and revenue from reconciled billable plays.

**Independent Test**: Known fixture of plays yields correct impression totals, distinct-vehicle reach, and revenue lines per pricing rules.

### Tests for User Story 3

> Required before implementation tasks (T026–T030).

- [x] T024 [P] [US3] Unit/fixture tests for aggregation (impressions, distinct-vehicle reach, revenue lines) in `app/openad-api/src/modules/analytics/services/reporting-aggregation.service.spec.ts`
- [x] T025 [P] [US3] Integration test: reporting API vs known fixture (SC-003 reach) in `app/openad-api/src/test/integration/analytics-reporting.integration.spec.ts`

### Implementation for User Story 3

- [x] T026 [P] [US3] Implement aggregation queries (impressions, distinct vehicles, cost lines) in `app/openad-api/src/modules/analytics/services/reporting-aggregation.service.ts`
- [x] T027 [US3] Expose read-only reporting routes (campaign-scoped, date window) with **versioned** path prefix consistent with repo API conventions in `app/openad-api/src/modules/analytics/analytics-reporting.controller.ts`
- [x] T028 [US3] Wire pricing multipliers and zone/time cost resolution using existing campaign pricing sources (inject from campaigns module as per `plan.md`) in `app/openad-api/src/modules/analytics/services/reporting-aggregation.service.ts`
- [x] T029 [P] [US3] Add campaign analytics view (impressions, reach, revenue) in `app/openad-management/src/app/features/campaign-analytics/pages/campaign-analytics.page.ts` and route registration in `app/openad-management/src/app/app.routes.ts`
- [x] T030 [P] [US3] Add management data service calling reporting API in `app/openad-management/src/app/features/campaign-analytics/services/campaign-analytics-api.service.ts`

**Checkpoint**: UI numbers match API totals for a fixed test campaign dataset.

---

## Phase 6: User Story 4 — Integrity and fraud signals (Priority: P4)

**Goal**: Flag or exclude suspicious plays (heartbeat density, implied speed, blackout) without blocking all traffic.

**Independent Test**: Injected scenarios produce `audit`, `fraud_velocity`, `fraud_heartbeat`, or `blackout` outcomes per policy. **SC-004**: v1 satisfies “audit queue” via queryable `reconciliationStatus` / operator filters on `play_records` (no separate queue collection unless product expands scope).

### Tests for User Story 4

- [x] T031 [P] [US4] Unit tests for fraud rules in `app/openad-api/src/modules/analytics/services/fraud-detection.service.spec.ts`

### Implementation for User Story 4

- [x] T032 [US4] Implement `FraudDetectionService` (heartbeat ratio window, implied speed from GPS + duration, display blackout) in `app/openad-api/src/modules/analytics/services/fraud-detection.service.ts`
- [x] T033 [US4] Correlate heartbeat counts via existing fleet telemetry module in `app/openad-api/src/modules/analytics/services/fraud-detection.service.ts` (adjust import path to actual telemetry service per repo layout)
- [x] T034 [US4] Invoke fraud pass after reconciliation (or as sub-stage) and persist `impliedSpeedKmh`, `heartbeatRatio`, and statuses in `app/openad-api/src/modules/analytics/processors/analytics-reconciliation.processor.ts`

**Checkpoint**: Fraud scenarios from `spec.md` acceptance table are observable on `play_records`.

---

## Phase 7: User Story 5 — Campaign pacing feedback (Priority: P5)

**Goal**: When cumulative daily spend nears budget (~95%), expose a signal the manifest/delivery path can use to lower priority on the next update.

**Independent Test**: Simulated spend crosses threshold → pacing state `near_cap`; new day or budget bump restores `normal`.

### Tests for User Story 5

> Required before implementation tasks (T037–T040).

- [x] T035 [P] [US5] Unit tests for daily threshold, timezone boundary, and `pacingState` transitions in `app/openad-api/src/modules/analytics/services/pacing-signal.service.spec.ts`
- [x] T036 [P] [US5] Integration test: spend simulation → pacing signal consumed by manifest path (SC-006) in `app/openad-api/src/test/integration/analytics-pacing.integration.spec.ts`

### Implementation for User Story 5

- [x] T037 [P] [US5] Create optional `campaign_daily_spend` Mongoose schema per `data-model.md` in `app/openad-api/src/modules/analytics/schemas/campaign-daily-spend.schema.ts`
- [x] T038 [US5] Implement rollup job or incremental updater for daily spend and `pacingState` in `app/openad-api/src/modules/analytics/services/pacing-signal.service.ts`
- [x] T039 [US5] Expose pacing snapshot for manifest or campaigns consumer (e.g. internal method + thin controller or existing manifest hook) in `app/openad-api/src/modules/analytics/pacing-signal.controller.ts` or `app/openad-api/src/modules/manifest/` integration point as chosen in implementation
- [x] T040 [US5] Consume pacing signal in delivery priority (manifest builder or campaign scheduling) in `app/openad-api/src/modules/manifest/generators/spatial-manifest-builder.service.ts` or adjacent scheduler per `plan.md` dependency graph

**Checkpoint**: Threshold crossing flips pacing state; headroom restores per acceptance scenarios.

---

## Phase 8: Polish & cross-cutting concerns

**Purpose**: Observability, docs, quickstart validation, performance (SC-005), and security checklist.

- [x] T041 [P] Add structured logging for ingest volume, reconciliation outcomes, and fraud flags in `app/openad-api/src/modules/analytics/`
- [x] T042 [P] Document public ingest and reporting routes in `specs/006-analytics-reconciliation/contracts/` and add OpenAPI/Swagger decorators where the API project uses them in `app/openad-api/src/modules/analytics/playback-batch.controller.ts` and `app/openad-api/src/modules/analytics/analytics-reporting.controller.ts`; note **semver / breaking-change policy** for these surfaces in contract docs or module README
- [x] T043 Run manual validation steps documented in `specs/006-analytics-reconciliation/quickstart.md` (Nx serve, ingest smoke, tablet buffer) and record any gaps in `specs/006-analytics-reconciliation/checklists/requirements.md` or issue tracker
- [x] T044 [P] Add tablet unit tests for buffer edge cases in `app/openad-ad-client/src/app/features/analytics/services/play-record-buffer.service.spec.ts`
- [x] T045 [P] Add tablet unit tests for batch assembly, gzip envelope, and retry behavior in `app/openad-ad-client/src/app/features/analytics/services/play-batch-uploader.service.spec.ts`
- [x] T046 [P] Add repeatable load or concurrency test (e.g. scripted k6 or Jest concurrent clients) targeting **ingest receipt only** (enqueue path) against `spec.md` **SC-005** and `plan.md` performance goals; store script or npm target under `app/openad-api/` or `tools/` with README pointer in `specs/006-analytics-reconciliation/quickstart.md`
- [x] T047 Complete **security review checklist** (auth on ingest/reporting, body size limits, gzip decompression limits, rate limits, least privilege) per `.specify/memory/constitution.md` Quality Gates §6; record outcome in PR description or `specs/006-analytics-reconciliation/checklists/requirements.md`

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1 (Setup)**: No dependencies; can parallel with Phase 2 planning.
- **Phase 2 (Foundational)**: Depends on contract types (T001–T002) for type-safe API code; blocks user-story API work.
- **Phases 3–7 (US1–US5)**: All depend on Phase 2. US2–US5 logically build on persisted plays (US1) and reconciled flags (US2); implement in priority order for safest integration.
- **Phase 8 (Polish)**: After desired user stories are complete (T046–T047 can run once ingest path exists).

### User story dependencies

- **US1 (P1)**: After Phase 2 — no other story required.
- **US2 (P2)**: After US1 data path exists (raw records + processor).
- **US3 (P3)**: After US2 populates `billable` / statuses (or minimally after US1 with mocked reconciliation for early UI spikes — not recommended for production).
- **US4 (P4)**: After US2 reconciliation pipeline; uses telemetry + reconciliation fields.
- **US5 (P5)**: After reporting cost lines (US3) or parallel if rollup reads `play_records` directly — prefer after US3 for consistent revenue inputs.

### Within each user story

- Tests (where listed) **before** implementation (TDD).
- Services before controllers; module registration last within the story.

### Parallel opportunities

- T002 parallel with T003–T004.
- T009–T010 parallel; T014 parallel with T011–T013 once contracts stable.
- T019 parallel with follow-on T020.
- T024–T025 parallel; T026 parallel with T029–T030 once tests green.
- T035–T036 parallel before T037–T040.

---

## Parallel example: User Story 1

```bash
# Contract + API tests in parallel:
pnpm exec nx run api-contracts:test --testPathPattern=playback-play-record
pnpm exec nx run openad-api:test --testPathPattern=analytics-playback-batch-ingest

# Tablet buffer vs API ingest service in parallel (different apps):
# Edit libs/api-contracts + openad-api ingest + openad-ad-client buffer
```

---

## Implementation strategy

### MVP first (User Story 1 only)

1. Complete Phase 1–2.
2. Complete Phase 3 (US1).
3. Stop and validate with `quickstart.md` ingest smoke.
4. Demo or deploy ingest-only if useful for edge fleet trials.

### Incremental delivery

1. US1 → stable ingest and immutable records.
2. US2 → trusted billable set.
3. US3 → management visibility.
4. US4 → risk signals.
5. US5 → spend protection.

### Parallel team strategy

- Developer A: US1 API path (`openad-api`).
- Developer B: US1 tablet path (`openad-ad-client`) after T001–T002.
- Developer C: Phase 2 + US2 reconciliation after US1 merge.

---

## Notes

- `[P]` tasks touch different files or are safely parallel after shared interfaces exist.
- Keep ingest handler to **validate + enqueue** only; load-test workers separately (`quickstart.md`).
- Reuse **005** geo-zone definitions for server-side geofence verification (FR in spec).
- Idempotency: `(deviceId, uniqueEventId)` unique index per `data-model.md`.
