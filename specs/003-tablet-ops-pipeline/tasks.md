---
description: "Task list for 003-tablet-ops-pipeline implementation"
---

# Tasks: Tablet Ops Pipeline

**Input**: Design documents from `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: **Required** — per OpenAD Constitution Principle VI (TDD), each phase below includes **failing tests first** (Red), then implementation (Green), then refactor. Do not skip test tasks.

**Organization**: Phases follow user story priority (P1→P4) after shared foundation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no ordering dependency within the same phase)
- **[Story]**: `[US1]`–`[US4]` for user-story phases only

## Path Conventions (Nx monorepo)

- API: `app/openad-api/src/`
- Management: `app/openad-management/src/app/`
- Tablet: `app/openad-ad-client/src/`
- Shared: `libs/domain/src/`, `libs/api-contracts/src/`, `libs/mqtt-contracts/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align work with existing Nx apps and spec artefacts before coding.

- [X] T001 Create working notes or branch checklist by reviewing `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/plan.md` against current `app/openad-api`, `app/openad-management`, `app/openad-ad-client`, `libs/domain`, `libs/api-contracts`, `libs/mqtt-contracts`
- [X] T002 [P] Verify local prerequisites and commands in `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/quickstart.md` against repo root `package.json` scripts and Nx targets (`openad-api:serve`, `openad-management:serve`, `openad-ad-client:serve`)
- [X] T003 [P] Add any new environment variables required for pairing, presigned screenshot uploads, and MQTT command TTLs to `/home/bode/Documents/repos/openad/openad-monorepo/.env.example` with short comments (do not commit secrets)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, persistence shapes, and auth hooks that every user story depends on.

**⚠️ CRITICAL**: User story phases must not start until this phase completes.

### Tests for Foundational (TDD — write first, ensure RED)

- [X] T004 [P] Add failing Jest tests for canonical fingerprint hashing in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/hardware-fingerprint.util.spec.ts` (normalisation, stable hash, mismatch cases)
- [X] T005 [P] Add failing Jest tests for `DeviceJwtAuthGuard` fingerprint enforcement in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/device-jwt-auth.guard.spec.ts` (`HARDWARE_MISMATCH`, valid `fp` claim)

### Implementation for Foundational

- [X] T006 [P] Add `HardwareFingerprint`, pairing-related, and `WatchdogEvent` TypeScript types to `/home/bode/Documents/repos/openad/openad-monorepo/libs/domain/src/lib/entities.ts` per `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/data-model.md`
- [X] T007 [P] Add pairing and manifest delta DTO interfaces to `/home/bode/Documents/repos/openad/openad-monorepo/libs/api-contracts/src/lib/types.ts` aligned with `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/contracts/rest-api.md`
- [X] T008 Implement `hardwareFingerprintHash` in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/hardware-fingerprint.util.ts` until **T004** tests pass (Green)
- [X] T009 Add Mongoose schemas `PairingRequestRecord`, `PairingSecretRecord`, and `PairingAttemptLogRecord` under `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/schemas/` and export via `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/devices.module.ts`
- [X] T010 Extend `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/devices.schema.ts` (or `Device` repository layer) with `hardwareFingerprintHash`, `lastManifestVersion`, and pairing lifecycle fields required by `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/data-model.md`
- [X] T011 Extend device JWT issuance in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/device-binding.service.ts` (or dedicated `device-token.service.ts`) to embed `fp` (fingerprint hash) claim and document payload shape in `/home/bode/Documents/repos/openad/openad-monorepo/libs/api-contracts/src/lib/types.ts`
- [X] T012 Update `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/device-jwt-auth.guard.ts` until **T005** tests pass (Green), then refactor without breaking tests
- [X] T013 Extend `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/fleet-monitor/remote-command.schema.ts` with new `type` enum values (`GET_SCREENSHOT`, `UPGRADE_APP`, `SET_VOLUME`, `SET_BRIGHTNESS`, `EMERGENCY_SYNC`) and lifecycle timestamps (`deliveredAt`, etc.) needed for FR-010; migrate existing `status` values or map legacy → new in service layer
- [X] T014 [P] Add Mongo indexes for pairing and commands in the same schema files or a `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/schemas/indexes.ts` referenced from module init per `data-model.md`

**Checkpoint**: Domain types, device JWT fingerprint enforcement, and extended command schema are in place — user stories can begin.

---

## Phase 3: User Story 1 — Hardware-Locked Secure Pairing (Priority: P1) — MVP

**Goal**: Pending device registration, admin-generated one-time secret (10 min, hashed), bind flow issuing device JWT + MQTT + manifest URL, hardware mismatch and replay rejection.

**Independent Test**: Register from tablet → see `Pending` in admin → generate secret → bind on tablet → device `Active` + token; wrong fingerprint / replay / expired secret rejected (see `spec.md` User Story 1).

### Tests for User Story 1 (TDD — write first, ensure RED)

- [X] T015 [P] [US1] Add failing Jest unit tests for `PairingService` in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/pairing.service.spec.ts` (secret hash not plaintext, TTL, single-use, fingerprint mismatch, replay)
- [X] T016 [P] [US1] Add failing API tests (supertest or existing e2e pattern) for pairing routes in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api-e2e/src/` or colocated `*.e2e-spec.ts` covering register/bind/admin secret per `contracts/rest-api.md`

### Implementation for User Story 1

- [X] T017 [US1] Implement `PairingService` (register, generateSecret, bind) in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/pairing.service.ts` until **T015** tests pass (Green) using hashed secrets per `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/research.md`
- [X] T018 [US1] Expose `POST /api/v1/devices/pairing/register`, `POST /api/v1/devices/pairing/bind`, and `POST /api/v1/admin/devices/:deviceId/pairing-secret` in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/devices.controller.ts` (or new `pairing.controller.ts`) until **T016** tests pass (Green)
- [X] T019 [US1] Persist `PairingAttemptLog` entries for success, failure, expired, replay, `hardware_mismatch` from `PairingService` using `PairingAttemptLogRecord` in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/pairing-audit.service.ts`
- [X] T020 [P] [US1] Add failing Angular unit tests for `hardware-fingerprint.service.ts` in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/hardware-fingerprint.service.spec.ts` (RED — mock Capacitor/Android APIs)
- [X] T021 [P] [US1] Implement `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/hardware-fingerprint.service.ts` until **T020** passes (GREEN) with IMEI, serial, MAC collection and `FINGERPRINT_UNAVAILABLE` per spec edge cases
- [X] T022 [US1] Wire first-launch pairing flow in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/` (extend or add `pairing-api.service.ts`) to call register/bind REST endpoints and emit `PairingEventsService` on success
- [X] T023 [US1] Update `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/device-session.service.ts` and token persistence to store device JWT from bind response if not already present
- [X] T024 [P] [US1] Add `PendingPairingComponent` (list + detail) under `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-management/src/app/pairing/` calling admin pairing APIs via a new `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-management/src/app/pairing/pairing-api.service.ts`
- [X] T025 [US1] Register routes in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-management/src/app/app.routes.ts` and shell nav in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-management/src/app/shared/shell/shell-nav.model.ts` for “Pending pairings”
- [X] T026 [US1] Add tablet UI for technician secret entry (dialog or page) in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/` integrated with `pairing-api.service.ts`

**Checkpoint**: User Story 1 is end-to-end testable per `quickstart.md` manual flow.

---

## Phase 4: User Story 2 — Remote Command & Control Pipeline (Priority: P2)

**Goal**: Dispatch `GET_SCREENSHOT`, `CLEAR_CACHE`, `UPGRADE_APP`, `SET_VOLUME`, `SET_BRIGHTNESS`; MQTT delivery + ack; lifecycle timestamps; offline queue + TTL; screenshot presigned upload; APK URL validation.

**Independent Test**: Issue each command type from admin to a connected test device; verify screenshot under 15 seconds, cache clear, APK install path, volume/brightness within 5 seconds; verify ack updates UI (see `spec.md` User Story 2).

### Tests for User Story 2 (TDD — write first, ensure RED)

- [X] T027 [P] [US2] Add failing unit tests for extended Zod schemas in `/home/bode/Documents/repos/openad/openad-monorepo/libs/mqtt-contracts/src/lib/mqtt-contracts.spec.ts` covering new command `type` variants and ack payloads per `contracts/mqtt.md`
- [X] T028 [P] [US2] Extend failing tests in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/fleet-monitor/remote-command.service.spec.ts` for per-type TTL defaults, `UPGRADE_APP` URL validation, and `GET_SCREENSHOT` presigned payload assembly

### Implementation for User Story 2

- [X] T029 [US2] Extend Zod `serverCommandPayloadSchema` and `commandAckPayloadSchema` in `/home/bode/Documents/repos/openad/openad-monorepo/libs/mqtt-contracts/src/lib/schemas.ts` until **T027** passes (Green)
- [X] T030 [US2] Update `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/fleet-monitor/remote-command.service.ts` until **T028** passes (Green), including FR-012 TTLs, `UPGRADE_APP` reachability check, presigned URL for `GET_SCREENSHOT`
- [X] T031 [US2] Align `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/fleet-monitor/command-dispatch.processor.ts` and `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/fleet-monitor/command-ack.handler.ts` with new `type` values and status transitions (`Pending`→`Delivered`→`Acknowledged` / failure / expired semantics)
- [X] T032 [US2] Add admin `POST /api/v1/admin/devices/:deviceId/commands` endpoint in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/fleet-monitor/` (or `devices`) controller matching `contracts/rest-api.md`
- [X] T033 [P] [US2] Extend `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-management/src/app/dashboard/command-panel.component.ts` and `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-management/src/app/dashboard/fleet-dashboard.service.ts` for new command types and payload fields
- [X] T034 [P] [US2] Add failing Angular unit tests for command handling in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/command-handler.service.spec.ts` (or equivalent) with mocks for MQTT and native APIs (RED)
- [X] T035 [US2] Extend `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/mqtt-client.service.ts` (or a dedicated `command-handler.service.ts`) until **T034** passes (GREEN): screenshot capture + upload to presigned URL, `CLEAR_CACHE` via `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/storage-manager.service.ts`, `UPGRADE_APP` via Capacitor installer, volume/brightness via native APIs
- [X] T036 [US2] Implement screenshot upload and 60 s timeout → `Acknowledged_Failure` behaviour in tablet service layer per spec edge cases
- [X] T037 [US2] Add scheduled job or Bull worker to mark expired commands `Expired` in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/fleet-monitor/` for devices that stay offline past TTL
- [X] T038 [P] [US2] Update `/home/bode/Documents/repos/openad/openad-monorepo/libs/api-contracts/src/lib/types.ts` `RemoteCommandListItem` and related types consumed by Management app for new statuses and command types

**Checkpoint**: User Story 2 verifiable from Fleet Monitor + MQTT without User Stories 3–4.

---

## Phase 5: User Story 3 — Self-Healing Tablet Watchdog (Priority: P3)

**Goal**: Deep Sleep on power loss + low battery; heartbeat `sleeping`/`awake`; Safety Loop after 24 h manifest failure; silent 3 AM player restart with deferral rules; optional `WatchdogEvent` logging.

**Independent Test**: Simulate power/battery conditions, manifest failure (or config fast-forward), and 3 AM trigger per `spec.md` User Story 3.

### Tests for User Story 3 (TDD — write first, ensure RED)

- [X] T039 [P] [US3] Add failing Angular unit tests for Deep Sleep, Safety Loop, and player restart schedulers in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/watchdog/deep-sleep.service.spec.ts`, `safety-loop.service.spec.ts`, `player-restart.scheduler.spec.ts` (use fake timers / injectable clock where needed)

### Implementation for User Story 3

- [X] T040 [US3] Extend `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/capacitor/power-state.plugin.ts` and consumers to meet 30 s grace period and FR-015–FR-017 (coordinate with existing battery/charging detection)
- [X] T041 [US3] Implement Deep Sleep orchestration in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/watchdog/deep-sleep.service.ts` until **T039** deep-sleep cases pass (Green)
- [X] T042 [US3] Implement Safety Loop in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/watchdog/safety-loop.service.ts` using bundled fallback asset path from `assets/` or `public/` and `manifest_unreachable` logging
- [X] T043 [US3] Track last successful manifest fetch timestamp in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/storage-manager.service.ts` or dedicated `manifest-health.service.ts` for 24 h staleness detection
- [X] T044 [US3] Implement daily 3 AM media player restart in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/watchdog/player-restart.scheduler.ts` with deferral when ad loop active and skip when Deep Sleep per spec edge cases
- [X] T045 [P] [US3] Optionally POST watchdog events to API or extend heartbeat payload per `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/contracts/mqtt.md` heartbeat extension (implement ingestor in `app/openad-api` if new topic fields require server-side persistence)

**Checkpoint**: Watchdog behaviours testable independently of delta sync (User Story 4).

---

## Phase 6: User Story 4 — Delta Sync and Bandwidth Economy (Priority: P4)

**Goal**: Manifest deltas, full first sync, Sync Window rules on device groups, MQTT config push ≤ 60 s, queued large downloads, byte-range resume, Emergency Sync command.

**Independent Test**: Campaign with 5 assets → delta adds 1 removes 1 → only one download; sync window queues large file until window; resume after drop (see `spec.md` User Story 4).

### Tests for User Story 4 (TDD — write first, ensure RED)

- [X] T046 [P] [US4] Add failing Jest tests for manifest delta computation / `sinceVersion` behaviour in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/manifest-delta.service.spec.ts` (or equivalent module path)
- [X] T047 [P] [US4] Add failing Angular unit tests for `sync-window-scheduler.service.ts` and `resumable-download.service.ts` under `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/sync/*.spec.ts` (window gating, resume offset)

### Implementation for User Story 4

- [X] T048 [US4] Implement `GET /api/v1/devices/:deviceId/manifest` with `sinceVersion` delta logic in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/devices/` or new `manifest/` module until **T046** passes (Green)
- [X] T049 [US4] Persist and bump `lastManifestVersion` / manifest snapshots in Mongo per `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/data-model.md` (collection or embedded strategy as per research)
- [X] T050 [US4] Add `SyncWindowRule` fields to device group schema and `PATCH` admin endpoint in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/modules/device-groups/` (or equivalent) per `contracts/rest-api.md`
- [X] T051 [US4] Extend MQTT `devices/{deviceId}/config` payload assembly in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/src/infrastructure/mqtt/mqtt.service.ts` (or `MqttService.publishDeviceConfig`) to include `syncWindows` and `configRevision` per `contracts/mqtt.md`
- [X] T052 [US4] Implement manifest client + delta applier in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/sync/manifest-sync.service.ts` (download added assets only, delete removed)
- [X] T053 [US4] Implement download scheduler with Sync Window gating in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/sync/sync-window-scheduler.service.ts` until **T047** scheduler tests pass (Green)
- [X] T054 [US4] Add byte-range resumable HTTP download helper in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-ad-client/src/app/services/sync/resumable-download.service.ts` using `Range` headers and checkpoint persistence until **T047** resume tests pass (Green)
- [X] T055 [US4] Handle `EMERGENCY_SYNC` / `CLEAR_CACHE` interaction with “force full sync” bypass in scheduler per FR-028 and User Story 4 acceptance scenario 7
- [X] T056 [P] [US4] Add Management UI for Sync Windows on device group edit in `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-management/src/app/device-groups/device-groups.component.ts` and `device-groups.service.ts`

**Checkpoint**: Delta sync and bandwidth rules work end-to-end with User Story 2 command `EMERGENCY_SYNC`.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, API surface, and validation across stories.

- [ ] T057 [P] Regenerate or update OpenAPI artefacts via `/home/bode/Documents/repos/openad/openad-monorepo/app/openad-api/project.json` `openapi` target after new endpoints stabilize
- [ ] T058 [P] Run full affected test targets from repo root (`pnpm exec nx run-many -t test --projects=openad-api,mqtt-contracts,openad-ad-client,openad-management` or subset per project configs); fix regressions
- [ ] T059 Security review: ensure pairing logs and `HARDWARE_MISMATCH` events use hashed fingerprint in logs per `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/research.md`
- [ ] T060 Execute manual validation steps in `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/quickstart.md` and update that file only if commands or paths drifted during implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately  
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user stories** — run **T004–T005 before T008, T012**  
- **Phase 3 (US1)**: Depends on Phase 2 — run **T015–T016 before T017–T018**; **T020** before **T021**  
- **Phase 4 (US2)**: Depends on Phase 2; **practically** depends on US1 for device JWT + MQTT — run **T027–T028 before T029–T030**  
- **Phase 5 (US3)**: Depends on Phase 2 — run **T039 before T041–T044**  
- **Phase 6 (US4)**: Depends on Phase 2 — run **T046–T047 before T048, T053–T054**  
- **Phase 7 (Polish)**: Depends on completed user stories for the current release scope

### User Story Dependencies

| Story | Depends on |
|-------|------------|
| US1 | Foundational only |
| US2 | Foundational + US1 (real device token and MQTT) |
| US3 | Foundational + stable MQTT/heartbeat (US1) |
| US4 | Foundational + US1 + manifest/campaign data path |

### Within Each User Story

- **Tests (RED) → Implementation (Green) → Refactor** per Constitution VI  
- API: schemas → services → controllers  
- Tablet: services → UI wiring  
- Management: API client → components → routes

### Parallel Opportunities

- **Phase 1**: T002, T003 parallel after T001  
- **Phase 2**: T004, T005, T006, T007, T014 parallel where no file conflict  
- **US1**: T015, T016, T020, T024 parallel after pairing service contract is clear (**T020** before **T021**)  
- **US2**: T027, T028, T033, T034, T038 parallel after schemas agreed (T034 before T035)  
- **US3**: T039 covers multiple spec files with [P] split  
- **US4**: T046, T047, T056 parallel after API shapes stable  
- **Polish**: T057, T058, T059 parallel

---

## Parallel Example: User Story 1

```bash
# RED first:
Task: "T015 pairing.service.spec.ts"
Task: "T016 pairing e2e/supertest"

# Then GREEN:
Task: "T017 PairingService"
Task: "T018 Controllers"
```

---

## Parallel Example: User Story 2

```bash
# RED first:
Task: "T027 mqtt-contracts schema tests"
Task: "T028 remote-command.service.spec.ts"

# Then GREEN:
Task: "T029 Zod schemas"
Task: "T030 RemoteCommandService"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 + Phase 2 (including **T004–T014**)  
2. Complete Phase 3 (including **T015–T026**)  
3. **STOP** — validate pairing per User Story 1 independent test + automated tests  
4. Demo / internal pilot

### Incremental Delivery

1. Setup + Foundational → foundation ready  
2. US1 → MVP pairing  
3. US2 → operational commands  
4. US3 → fleet reliability on tablet  
5. US4 → data cost control  
6. Polish → release hardening

### Parallel Team Strategy

- After Foundational: Developer A on US1 implementation, Developer B keeps **T016** e2e green  
- After US1+US2: split US3 (tablet-only tests **T039**) and US4 (API **T046** + client **T047**)

---

## Notes

- [P] tasks = different files, no strict ordering dependency unless noted  
- **Never merge implementation PRs without corresponding test tasks completed**  
- Command `status` naming: align UI, API, and Mongo with a single mapping table in `remote-command.service.ts`

---

## Task Summary

| Phase | Task IDs | Count |
|-------|----------|------:|
| Setup | T001–T003 | 3 |
| Foundational tests | T004–T005 | 2 |
| Foundational impl | T006–T014 | 9 |
| US1 tests | T015–T016 | 2 |
| US1 impl | T017–T026 | 10 |
| US2 tests | T027–T028, T034 | 3 |
| US2 impl | T029–T033, T035–T038 | 9 |
| US3 tests | T039 | 1 |
| US3 impl | T040–T045 | 6 |
| US4 tests | T046–T047 | 2 |
| US4 impl | T048–T056 | 9 |
| Polish | T057–T060 | 4 |
| **Total** | **T001–T060** | **60** |

**Test task count**: **12** explicit RED/first tasks — **T004–T005**, **T015–T016**, **T020** (tablet fingerprint tests), **T027–T028**, **T034** (command-handler tests), **T039**, **T046–T047**.

**Suggested MVP scope**: Phases 1–3 through **T026** — Hardware-Locked Secure Pairing with TDD.

**Format validation**: All tasks use `- [ ]`, sequential `T###`, optional `[P]`, story labels `[US#]` only in Phases 3–6, and concrete file paths in descriptions.
