# Tasks: MDM APK Distribution & Updates

**Input**: Design documents from `/home/bode/Documents/repos/openad-monorepo/specs/009-mdm-apk-distribution/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Omitted — the feature spec does not mandate TDD; add tests later if the team adopts the testing notes in `plan.md`.

**Organization**: Tasks are grouped by user story (P1 → P3) after shared setup and foundation work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency on incomplete tasks in the same phase)
- **[Story]**: `[US1]`–`[US3]` for user-story phases only
- Paths are repo-relative from the monorepo root unless noted

## Path Conventions (this feature)

- **API**: `app/openad-api/src/modules/releases/` (new module slice; register in `app/openad-api/src/app/app.module.ts`)
- **Management**: `app/openad-management/src/app/releases/` (new lazy area; routes in `app/openad-management/src/app/app.routes.ts`)
- **Android client**: `app/openad-ad-client/` (`src/` for TS, `android/` for Gradle/signing/DPC)
- **Shared contracts**: `libs/api-contracts/src/`, `libs/mqtt-contracts/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align paths and configuration before coding the releases slice.

- [x] T001 Map implementation directories for this feature per `specs/009-mdm-apk-distribution/plan.md`: `app/openad-api/src/modules/releases/`, `app/openad-management/src/app/releases/`, `app/openad-ad-client/src/app/`, `libs/api-contracts/src/`, `libs/mqtt-contracts/src/`
- [x] T002 Add environment variables for release APK storage (object-storage key prefix or bucket) and for the public HTTPS base URL used in `downloadUrl` fields in `app/openad-api/src/app/env.validation.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Mongo models, storage integration, shared wire types, and Nest module registration required by all user stories.

**⚠️ CRITICAL**: No user story phase should merge until this phase is complete.

- [x] T003 Create Mongoose schemas `Release`, `ReleasePublication`, `Rollout`, and release-related `AuditEvent` collections under `app/openad-api/src/modules/releases/schemas/` per `specs/009-mdm-apk-distribution/data-model.md`
- [x] T004 Extend `app/openad-api/src/modules/devices/devices.schema.ts` with `currentRelease` and `updateState` fields per `specs/009-mdm-apk-distribution/data-model.md`
- [x] T005 [P] Implement `releases-storage.service.ts` in `app/openad-api/src/modules/releases/services/` to store and retrieve APK bytes via `app/openad-api/src/infrastructure/storage/` (S3-compatible / existing asset patterns)
- [x] T006 [P] Define exported TypeScript types for the REST shapes in `specs/009-mdm-apk-distribution/contracts/release-manifest.md` in `libs/api-contracts/src/lib/release-manifest.ts` and re-export from `libs/api-contracts/src/index.ts`
- [x] T007 Create `releases.module.ts` in `app/openad-api/src/modules/releases/releases.module.ts` registering schemas, services, and controllers; import `ReleasesModule` in `app/openad-api/src/app/app.module.ts` and `app/openad-api/src/test/test-app.module.ts`

**Checkpoint**: Database models, storage access, and module wiring exist; story work can proceed.

---

## Phase 3: User Story 1 — Publish an installable release via QR (Priority: P1) 🎯 MVP

**Goal**: Superadmin uploads a signed APK, registers version metadata, publishes exactly one “latest approved stable” pointer, and the management panel shows a QR whose payload provisions a freshly reset device (Device Owner) and installs that release.

**Independent Test**: Upload one release, set it as latest approved, scan the provisioning QR on a test device, confirm the installed version matches the published release.

- [x] T008 [US1] Implement core `releases.service.ts` in `app/openad-api/src/modules/releases/services/releases.service.ts` (create release record, compute integrity metadata, validate MIME/extension, persist artifact metadata)
- [x] T009 [P] [US1] Implement superadmin-only multipart upload endpoint and DTO validation in `app/openad-api/src/modules/releases/releases-admin.controller.ts` (integrate with existing auth/roles patterns from `app/openad-api/src/modules/auth/`)
- [x] T010 [US1] Implement publish-latest-stable operation persisting `ReleasePublication` in `app/openad-api/src/modules/releases/services/release-publication.service.ts` and expose it via `app/openad-api/src/modules/releases/releases-admin.controller.ts`
- [x] T011 [P] [US1] Implement `release-audit.service.ts` in `app/openad-api/src/modules/releases/services/release-audit.service.ts` and emit audit events for upload, publish, and QR-related actions per `specs/009-mdm-apk-distribution/data-model.md`
- [x] T012 [US1] Implement device- or public-readable `GET` handler for latest stable manifest per `specs/009-mdm-apk-distribution/contracts/release-manifest.md` in `app/openad-api/src/modules/releases/releases-manifest.controller.ts` (include throttling/guards consistent with `app/openad-api/src/modules/manifest/manifest.controller.ts` patterns)
- [x] T013 [P] [US1] Add lazy route and shell components under `app/openad-management/src/app/releases/` and register a child route in `app/openad-management/src/app/app.routes.ts` restricted to Superadmin (reuse existing auth guards / role checks)
- [x] T014 [US1] Build Superadmin UI for upload, version display, publish-latest control, and provisioning QR in `app/openad-management/src/app/releases/releases-admin.page.ts` (and co-located components/services), calling the new API using existing HTTP client conventions
- [x] T015 [P] [US1] Configure Android signing `applicationId`, keystore, and build types in `app/openad-ad-client/android/app/build.gradle` and `app/openad-ad-client/android/gradle.properties` so the built APK matches the DPC package referenced by managed provisioning
- [x] T016 [US1] Implement managed-provisioning QR payload generation (JSON for Android 7+ provisioning) in `app/openad-management/src/app/releases/provisioning-qr.service.ts`, sourcing the APK `downloadUrl` and integrity fields from the latest stable manifest response shape

**Checkpoint**: QR provisioning installs the published release; audit records exist for sensitive actions.

---

## Phase 4: User Story 2 — Device auto-checks for updates daily (Priority: P2)

**Goal**: Devices compare their installed version to the server’s approved update target on a daily schedule; staged rollout rules decide eligibility; silent download, verify, install; server records per-device version and update status.

**Independent Test**: Leave a device on an older build, publish a newer approved release with rollout rules that include the device, wait for or simulate the daily check, confirm silent update completes and the management UI shows the new version.

- [x] T017 [US2] Implement `rollout-eligibility.service.ts` in `app/openad-api/src/modules/releases/services/rollout-eligibility.service.ts` using `Rollout`, device group membership (`app/openad-api/src/modules/device-groups/`), and deterministic percentage bucketing per `specs/009-mdm-apk-distribution/research.md`
- [x] T018 [US2] Implement authenticated `GET` per-device update manifest (eligible flag + nullable target) per `specs/009-mdm-apk-distribution/contracts/release-manifest.md` in `app/openad-api/src/modules/releases/releases-device.controller.ts` using `ManifestDeviceJwtGuard` or equivalent device identity pattern from `app/openad-api/src/modules/manifest/guards/manifest-device-jwt.guard.ts`
- [x] T019 [P] [US2] Expose rollout create/activate/pause endpoints for administrators in `app/openad-api/src/modules/releases/releases-admin.controller.ts` backed by `Rollout` persistence
- [x] T020 [P] [US2] Add rollout configuration UI (groups / percentage / state) in `app/openad-management/src/app/releases/rollout-config.component.ts` and embed or route from `app/openad-management/src/app/releases/releases-admin.page.ts`
- [x] T021 [US2] Add device API to report installed release version and update-check results, persisting to `devices.schema.ts` fields, implemented in `app/openad-api/src/modules/releases/releases-device.controller.ts` or by extending `app/openad-api/src/modules/devices/devices.controller.ts` with thin delegation to `releases.service.ts`
- [x] T022 [P] [US2] Implement `app-update-scheduler.service.ts` in `app/openad-ad-client/src/app/services/` to trigger periodic manifest fetch (daily window) using Capacitor/App plugin constraints
- [x] T023 [US2] Implement silent update pipeline in `app/openad-ad-client/src/app/services/app-update.service.ts`: fetch manifest, compare versions, download APK, verify using `app/openad-ad-client/src/app/features/sync/services/hash-verifier.service.ts`, install via native bridge in `app/openad-ad-client/src/app/services/tablet-native-integration.service.ts`, handle interrupted download and invalid artifact per `specs/009-mdm-apk-distribution/spec.md` edge cases
- [x] T024 [US2] Read installed version from `app/openad-ad-client/src/app/core/services/device-info.service.ts` (extend if needed) and POST to the version-reporting endpoint after successful checks/updates

**Checkpoint**: Daily silent updates respect staged rollout; devices outside eligibility do not install; version reporting visible in admin.

---

## Phase 5: User Story 3 — Remotely trigger an update check (Priority: P3)

**Goal**: Operators send a remote “update check now” command over the existing MQTT command path; online devices start the check within the latency budget; offline behavior is safe and visible.

**Independent Test**: From the management or fleet UI/API, dispatch the command to one online device and confirm the client runs the same update path as the daily scheduler; test offline device shows queued/failed state without corrupting device records.

- [x] T025 [US3] Add Zod schema + TypeScript types for the update-check command payload in `libs/mqtt-contracts/src/lib/update-check-command.contract.ts` and export from `libs/mqtt-contracts/src/index.ts` per `specs/009-mdm-apk-distribution/contracts/mqtt-update-command.md`
- [x] T026 [US3] Extend `app/openad-ad-client/src/app/services/command-handler.service.ts` and `app/openad-ad-client/src/app/features/mqtt/services/mqtt-client.service.ts` to parse the new command type and invoke `app-update.service.ts`
- [x] T027 [US3] Add API surface (Nest controller method) in `app/openad-api/src/modules/releases/releases-command.controller.ts` or extend `app/openad-api/src/modules/priority-commands/` to publish the MQTT message via `app/openad-api/src/infrastructure/mqtt/mqtt.service.ts` with validated payload
- [x] T028 [US3] Add minimal operator UI action and status display in `app/openad-management/src/app/releases/` or `app/openad-management/src/app/devices/device-overview.page.ts` to trigger update-check and show last command outcome

**Checkpoint**: Remote check path matches US2 behavior; operator visibility for failures.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, observability, and validation against the quickstart.

- [x] T029 Run through `specs/009-mdm-apk-distribution/quickstart.md` smoke checklist and fix gaps in `app/openad-ad-client/android/` or API responses as needed
- [x] T030 [P] Register Swagger tags/descriptions for new release endpoints in `app/openad-api/src/main.ts` `DocumentBuilder` and annotate controllers with `@ApiTags`
- [x] T031 Add structured logging for release download/install failures in `app/openad-ad-client/src/app/services/app-update.service.ts` and server-side manifest endpoints in `app/openad-api/src/modules/releases/` without logging sensitive integrity secrets

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **blocks all user stories**
- **User stories (Phases 3–5)**: Depend on Foundational completion
  - **US1 (P1)** should complete before treating QR provisioning as done; US2/US3 assume manifest and storage exist
  - **US2 (P2)** depends on US1 for a published latest-stable channel and working APK artifacts (cannot validate updates without a baseline release)
  - **US3 (P3)** depends on US2 for the client update pipeline (`app-update.service.ts`) — remote command only triggers that pipeline
- **Polish (Phase 6)**: After the user stories targeted for the release are done

### User Story Dependency Graph

```text
Foundational (T003–T007)
        │
        ▼
      US1 (T008–T016)  ──►  US2 (T017–T024)  ──►  US3 (T025–T028)
        │                         │                      │
        └─────────────────────────┴──────────────────────┴──► Polish (T029–T031)
```

### Within Each Story

- Mongo schemas and `ReleasesModule` before HTTP handlers
- Admin upload before publish-latest and QR
- Client manifest `GET` before Android update client calls the same URLs
- Eligibility service before device update manifest endpoint returns `eligible` / `target`
- `app-update.service.ts` before command handler invokes it

### Parallel Opportunities

- **Phase 2**: T005 and T006 can proceed in parallel (storage service vs `libs/api-contracts` types) once T003 schemas exist
- **US1**: T009, T011, T013, T015 can parallelize across team members after T008 is sketched (coordinate on DTO shapes from T006)
- **US2**: T019 and T020 parallel (API vs Angular); T022 parallel with T023 once device manifest endpoint (T018) is stable
- **US3**: T025 can start in parallel with US2 wrap-up if payload shape is frozen from `contracts/mqtt-update-command.md`

---

## Parallel Example: User Story 1

```bash
# After T008 exists (shared service sketch):
# Developer A: T009 releases-admin.controller.ts multipart upload
# Developer B: T011 release-audit.service.ts audit writes
# Developer C: T015 Android Gradle signing + T016 provisioning QR service
```

---

## Parallel Example: User Story 2

```bash
# After T017 rollout-eligibility.service.ts:
# Developer A: T018 releases-device.controller.ts GET update manifest
# Developer B: T020 rollout-config.component.ts
# Developer C: T022 app-update-scheduler.service.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1–2 (T001–T007)
2. Complete Phase 3 (T008–T016)
3. **Stop and validate** using the US1 independent test (QR provision + correct version)
4. Demo to stakeholders before building staged rollout automation

### Incremental Delivery

1. Foundation → US1: field-installable QR provisioning
2. Add US2: fleet stays current with staged rollout safety
3. Add US3: urgent patch path without waiting for daily window
4. Polish: docs, Swagger, logging consistency

### Parallel Team Strategy

1. Shared Foundation (single swarm or pair)
2. Split: API engineer on US1 backend, frontend engineer on management UI, Android engineer on signing + provisioning payload (T015–T016)
3. US2: same split across eligibility, client scheduler, and rollout UI

---

## Notes

- **[P]** = different files and no hard ordering dependency; still avoid merge conflicts on shared files (`env.validation.ts`, `app.routes.ts`)
- Rollout applies to **updates**, not initial QR install — keep `ReleasePublication` for latest stable separate from `Rollout` targeting (`specs/009-mdm-apk-distribution/spec.md` clarifications)
- Reuse existing MQTT infrastructure; do not introduce a second broker client pattern
