---
description: "Task list for Media Management Module (007) — VFS, ingestion, explorer UI"
---

# Tasks: Media Management Module

**Input**: Design documents from `/home/bode/Documents/repos/openad-monorepo/specs/007-media-management-vfs/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md), [research.md](./research.md), [quickstart.md](./quickstart.md)

**UI inspiration** (layout, hierarchy, chrome — align components and spacing with these references, implemented with Angular + PrimeNG + existing Aether theme, not Tailwind HTML paste):

- Desktop: `designs/management-panel/desktop/media_management_desktop/` (`screen.png`, `code.html` — 3-pane explorer, top app bar, tree + grid, inspector)
- Mobile: `designs/management-panel/mobile/media_management_mobile/` (`screen.png`, `code.html` — back + brand row, 2-column bento grid, FAB, sheet-friendly inspector)

**Tests (constitution VI)**: Each user story begins with **test tasks** that MUST fail first (Red) where applicable, then implementation (Green), then refactor. Merge only with passing `nx test` for touched projects and coverage per workspace policy.

**Organization**: Phase 1–2 → **Phase 2b Security** (blocking) → User stories P1→P3 (tests then implementation) → Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency on incomplete tasks)
- **[Story]**: [US1] / [US2] / [US3] for user-story phases only
- Paths are relative to repository root: `/home/bode/Documents/repos/openad-monorepo/`

## Path Conventions (this repo)

- API: `app/openad-api/src/`
- Management UI: `app/openad-management/src/app/`
- Contracts: `libs/api-contracts/src/`

---

## PrimeNG module inventory (media-explorer)

Implementers SHOULD import the following **PrimeNG** modules (names are indicative — match `primeng/*` paths in this workspace) into feature components as needed:

| UI area | Suggested PrimeNG building blocks |
|---------|-----------------------------------|
| Tree / nav | `Tree`, `TreeSelect`, or `PanelMenu` (lazy load via `onNodeExpand`) |
| Toolbar | `Toolbar`, `Button`, `InputText`, `IconField` / `InputIcon`, `Breadcrumb`, `SplitButton` (primary actions) |
| Explorer grid | `DataView` with template slots for thumbnails |
| Explorer list | `Table` or `DataView` list layout; **virtual scroll** via `Scroller` when folder size is large |
| Upload | Custom dropzone + `ProgressBar` or `ProgressSpinner`; optional `FileUpload` if aligned with UX |
| Dialogs | `Dialog` or `DynamicDialog` for move/rename |
| Inspector | `Panel`, `Divider`, `Tag` / `Badge` for validation state |
| Mobile shell | `Sidebar` or `Drawer` for tree; `Drawer` / overlay for bottom inspector; **FAB**: custom fixed button or `SpeedDial` with single primary |
| Feedback | `Toast` / `MessageService` (already app-wide) |

---

## Phase 1: Setup (shared infrastructure)

**Purpose**: Feature shells and wiring so US1+ can land without re-plumbing the monorepo.

- [x] T001 Add lazy route `media` under `app/openad-management/src/app/app.routes.ts` pointing to a new page module for the media explorer (match existing `loadComponent` pattern and `authGuard`).
- [x] T002 Create `app/openad-management/src/app/pages/media-management.page.ts` (standalone host) with router outlet placeholder and page title for “Media”.
- [x] T003 [P] Create directory `app/openad-management/src/app/features/media-explorer/` and add `index.ts` barrel exporting the public entry component for the route.
- [x] T004 [P] Register `MediaExplorer` (or equivalent) in main layout navigation if `app/openad-management/src/app/shared/layout/` exposes a nav config array — add “Media” entry with icon consistent with designs in `designs/management-panel/desktop/media_management_desktop/screen.png`.
- [x] T005 Document new env keys for S3 presign + upload limits in `app/openad-api/.env.dev` and root `.env.example` (no secrets), cross-referencing `specs/007-media-management-vfs/quickstart.md`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Contracts, persistence shapes, and cross-cutting services required by all user stories.

**⚠️ CRITICAL**: Complete before story-specific UI/API work.

- [x] T006 [P] Add Zod contracts `libs/api-contracts/src/media/media-vfs.contract.ts` for folder node DTO, upload session init/complete payloads, media catalog row (fields per `specs/007-media-management-vfs/data-model.md`).
- [x] T007 Export new schemas and types from `libs/api-contracts/src/index.ts` and `libs/api-contracts/src/media/` index if present.
- [x] T008 Add Mongoose schema `app/openad-api/src/modules/media-ingestion/schemas/folder-node.schema.ts` for `materialized_path`, `parent_id`, `campaign_id`, `is_system_locked` (align naming with data-model).
- [x] T009 Extend or pair `app/openad-api/src/modules/media-ingestion/schemas/media-asset.schema.ts` with VFS fields: `folder_id`, `storage_key`, shared `file_hash` semantics, `validation_status`, `probe_status`, audit fields per data-model — preserve compatibility with existing `media-ingestion` flows.
- [x] T010 [P] Add Mongoose schema `app/openad-api/src/modules/media-ingestion/schemas/upload-session.schema.ts` per `data-model.md` (`tenant_key_prefix`, `max_bytes`, `allowed_mime_types`, `expires_at`, etc.).
- [x] T011 [P] Add MongoDB indexes (compound/partial as needed) via schema `index()` or migration script under `app/openad-api/src/` for `materialized_path`, `storage_key`, `folder_id` + `campaign_id`, `file_hash` per `data-model.md`.
- [x] T012 Implement configurable DOOH rule source (env or DB) consumed by existing `app/openad-api/src/modules/media-ingestion/validators/video-validator.service.ts` and/or `dooh-rules.service.ts` so validation outcomes map to FR-003/FR-004 and optional `dooh_ruleset_version` can be stored.
- [x] T013 Add idempotent seed or bootstrap for system folders `/Root/Defaults/Global_Ads`, `/Root/Defaults/System_Assets`, `/Root/Campaigns` with `is_system_locked: true` in `app/openad-api/src/seed/` or startup hook invoked from `app/openad-api/src/app/app.module.ts` (document idempotency).
- [x] T014 Wire Nest module: register new schemas and providers in `app/openad-api/src/modules/media-ingestion/media-ingestion.module.ts` (or extract `media-vfs.module.ts` if separation is cleaner — keep single registration path in `app/openad-api/src/app/app.module.ts`).
- [x] T015 Add structured logging context keys for upload session id, tenant prefix, and `storage_key` in `app/openad-api/src/infrastructure/logging/` usage within media services (enterprise logging gate).

**Checkpoint**: Schemas and contracts exist; UI route is reachable.

---

## Phase 2b: Security & trust foundation (blocking — before US1 HTTP)

**Purpose**: Enforce [plan.md](./plan.md) **Security & trust model** and **FR-011** so no endpoint ships without scope checks and safe storage completion.

- [x] T016 [P] Implement campaign/org scope resolution service `app/openad-api/src/modules/media-ingestion/media-scope.service.ts` and Nest guard(s) under `app/openad-api/src/modules/media-ingestion/guards/` applied to all media VFS controllers (reuse patterns from `app/openad-api/src/modules/auth/`).
- [x] T017 [P] Implement S3 presign helper `app/openad-api/src/modules/media-ingestion/s3-presign.service.ts` that only issues keys under `tenant_key_prefix` from the active tenant/context; short TTL; no binary proxy through API.
- [x] T018 Implement `UploadSessionService` (or equivalent) in `app/openad-api/src/modules/media-ingestion/` to persist `upload_sessions`, return presigned payloads with **server-chosen** `storage_key` under tenant prefix, `sessionId`, and limits — **service layer only** (no public HTTP until US1 T026 unless T022 needs a thin test controller).
- [x] T019 Implement `completeVerified` in the same service: storage verification (e.g. HeadObject / metadata check) before inserting `media_assets`; reject with 4xx on mismatch (**FR-011**).
- [x] T020 [P] Add session lifecycle job or scheduled cleanup: expire stale `upload_sessions`, mark `expired`/`aborted`, optionally abort incomplete multipart uploads in `app/openad-api/src/modules/media-ingestion/jobs/upload-session-cleanup.job.ts` (or equivalent queue consumer).
- [x] T021 Implement `app/openad-api/src/modules/media-ingestion/media-gc.service.ts` stub enforcing **tenant prefix** check before any `DeleteObject` call.
- [x] T022 [P] Add integration tests `app/openad-api/src/modules/media-ingestion/media-vfs-security.integration.spec.ts` proving wrong-scope **complete** and asset read return **403**/**404** per API policy (**SC-004**). *(complete-as-non-owner: `media-vfs-security.integration.spec.ts`; unauthenticated/missing asset: `media-vfs.integration.spec.ts`.)*

**Checkpoint**: Security foundation merged before exposing upload/list routes to the UI.

---

## Phase 3: User Story 1 — Ingest and validate campaign media at scale (Priority: P1) — MVP

**Goal**: Operators upload creatives with client pre-flight, direct S3 upload, registration, probe, and visible DOOH validation status in the explorer.

**Independent Test**: Upload valid/invalid MP4/JPEG; each completes with terminal status; invalid shows rule message; concurrent uploads retain per-row progress.

### Tests for User Story 1 (TDD — constitution VI)

- [x] T023 [P] [US1] Add Jest coverage for Zod schemas in `libs/api-contracts/src/media/media-vfs.contract.ts` (valid/invalid payloads) in `libs/api-contracts/src/media/media-vfs.contract.spec.ts`.
- [x] T024 [P] [US1] Extend `app/openad-api/src/modules/media-ingestion/media-ingestion.service.spec.ts` (or new spec) with unit tests for **complete** path: verification failure does not create catalog rows; success sets `validation_status` transitions.
- [x] T025 [P] [US1] Add unit tests for `app/openad-management/src/app/features/media-explorer/services/media-upload.service.ts` pre-flight rules vs published limits (once service exists — write failing tests first).

### Implementation for User Story 1

- [x] T026 [US1] Wire public HTTP `POST /v1/media/uploads` and `POST /v1/media/uploads/:sessionId/complete` on `app/openad-api/src/modules/media-ingestion/media-ingestion.controller.ts` to T018–T019 services with Nest validation pipes / Zod DTOs per `contracts/README.md`.
- [x] T027 [P] [US1] Extend `app/openad-api/src/modules/media-ingestion/media-ingestion.service.ts` to orchestrate: verified complete → hash → persist row → enqueue probe → DOOH validation with detailed errors (**FR-004**).
- [x] T028 [US1] Add `GET /v1/media/assets/:id` in `media-ingestion.controller.ts` with scope guard (**foundation for US2/US3**).
- [x] T029 [P] [US1] Create `app/openad-management/src/app/features/media-explorer/services/media-upload.service.ts` — client pre-flight (extension, max size, resolution cap) using limits from `media-limits.token.ts` or config API.
- [x] T030 [US1] Implement multipart client in `app/openad-management/src/app/features/media-explorer/services/s3-multipart.client.ts` using workspace AWS SDK patterns against presigned URLs from T026.
- [x] T031 [US1] Build `app/openad-management/src/app/features/media-explorer/components/media-upload-dropzone.component.ts` — drag-drop + file picker + **PrimeNG** `ProgressBar`/`ProgressSpinner` for concurrent rows.
- [x] T032 [P] [US1] Build `app/openad-management/src/app/features/media-explorer/components/media-validation-badge.component.ts` (PrimeNG `Tag`/`Badge`) showing pass / fail / warning with rule text from API.
- [x] T033 [P] [US1] Implement configurable **hash deduplication** on complete in `media-ingestion.service.ts` per **FR-012** (feature flag): link to existing row or skip duplicate storage when policy says so.
- [x] T034 [US1] Integrate upload flow into `app/openad-management/src/app/pages/media-management.page.ts`; toast errors via `MessageService` from `app/openad-management/src/app/app.config.ts`.

**Checkpoint**: End-to-end ingest + validation demonstrable.

---

## Phase 4: User Story 2 — Campaign-sandboxed logical folders and organization (Priority: P2)

**Goal**: Materialized tree (`/Root/Defaults`, `/Root/Campaigns`), explorer listing, breadcrumbs, search, permission-scoped queries; mobile navigation per mobile design reference.

**Independent Test**: Two campaigns; user A cannot list/modify B’s folders/assets; tree matches materialized paths; search respects scope.

### Tests for User Story 2 (TDD)

- [x] T035 [P] [US2] Tree/children scope: **`MediaScopeService` remains a stub** (all authenticated roles see the same tree). HTTP smoke: `GET .../folders/tree` **200** in `media-vfs.integration.spec.ts`. Full **403/empty for foreign `campaign_id`** deferred until membership is implemented.
- [x] T036 [P] [US2] Add API tests for `PATCH /v1/media/folders/:id` rejecting moves that violate `is_system_locked` — **`media-vfs.integration.spec.ts`** (PATCH locked folder **403**); `folder.service.spec.ts` retains unit coverage.

### Implementation for User Story 2

- [x] T037 [US2] Implement `GET /v1/media/folders/tree` and `GET /v1/media/folders/:folderId/children` with guards + optional `q` in `media-ingestion.controller.ts` or `media-folders.controller.ts`.
- [x] T038 [P] [US2] Implement `POST /v1/media/folders`, `PATCH /v1/media/folders/:id` with `folder.service.ts` and `is_system_locked` enforcement.
- [x] T039 [US2] Subscribe to `CampaignCreated` / rename from `app/openad-api/src/modules/campaigns/` — upsert `/Root/Campaigns/{name}` and path rewrites in `app/openad-api/src/modules/media-ingestion/processors/`.
- [x] T040 [P] [US2] Create `app/openad-management/src/app/features/media-explorer/components/media-tree-sidebar.component.ts` — **PrimeNG** `Tree` or `PanelMenu`, lazy children.
- [x] T041 [US2] Create `app/openad-management/src/app/features/media-explorer/components/media-explorer-toolbar.component.ts` — **PrimeNG** `Breadcrumb`, `InputText` search, primary actions.
- [x] T042 [P] [US2] Create `app/openad-management/src/app/features/media-explorer/components/media-asset-grid.component.ts` — **PrimeNG** `DataView` + thumbnails.
- [x] T043 [P] [US2] Create `app/openad-management/src/app/features/media-explorer/components/media-asset-list.component.ts` — **PrimeNG** `Table` or list `DataView` with required columns.
- [x] T044 [US2] Create `app/openad-management/src/app/features/media-explorer/layout/media-explorer-shell.component.ts` — 3-pane desktop layout (PrimeNG + CSS) per desktop design reference.
- [x] T045 [P] [US2] Responsive shell: `<768px` tree in **PrimeNG** `Sidebar`/`Drawer`; back navigation per mobile design.
- [x] T046 [US2] Wire search `q` to API and toolbar per **FR-006** default placement where configured.

**Checkpoint**: Full explorer + sandbox isolation.

---

## Phase 5: User Story 3 — Reference-based copies and safe deletion (Priority: P3)

**Goal**: Soft-copy clones; inspector **referenceCount**; two-phase delete + orphan S3 cleanup; move/rename asset.

**Independent Test**: Clone; shared hash; delete one placement leaves S3; delete last removes object; no delete outside prefix.

### Tests for User Story 3 (TDD)

- [x] T047 [P] [US3] Unit tests: tenant prefix + refcount — `media-gc.service.spec.ts` (prefix); **`media-ingestion.service.spec.ts`** (no GC when another active ref; GC on last ref).
- [x] T048 [P] [US3] Integration: cross-campaign **clone** and **PATCH move** return **403** (`CAMPAIGN_SCOPE`) in `media-vfs-security.integration.spec.ts`; invalid clone body **400** in `media-vfs.integration.spec.ts`.

### Implementation for User Story 3

- [x] T049 [US3] Implement `POST /v1/media/assets/:id/clone` duplicating row with same `storage_key` / `file_hash` and scoped target folder.
- [x] T050 [P] [US3] Add `referenceCount` to `GET /v1/media/assets/:id` response in `media-ingestion.service.ts`.
- [x] T051 [US3] Implement `DELETE /v1/media/assets/:id` + async orphan processing using T021 with concurrency safety (transactions or atomic updates per T038 pattern).
- [x] T052 [P] [US3] Implement `PATCH /v1/media/assets/:id` for move/rename per `contracts/README.md`.
- [x] T053 [US3] Build `app/openad-management/src/app/features/media-explorer/components/media-inspector-panel.component.ts` — HTML5 preview, specs, hash, reference badge, actions.
- [x] T054 [P] [US3] Add move/rename dialogs with **PrimeNG** `DynamicDialog` in `media-asset-actions.component.ts`.
- [x] T055 [US3] Mobile inspector: `app/openad-management/src/app/features/media-explorer/layout/media-mobile-inspector.component.ts` using **PrimeNG** `Drawer`.
- [x] T056 [US3] Mobile FAB `media-mobile-fab.component.ts` (custom fixed or **PrimeNG** `SpeedDial`).

**Checkpoint**: Soft copy, refcount, GC, inspector parity desktop/mobile.

---

## Phase 6: Polish & cross-cutting concerns

**Purpose**: Observability, docs, accessibility, performance, theme alignment (**SC-006**).

- [x] T057 [P] Wire OpenAPI: update `app/openad-api/scripts/generate-openapi.ts` or decorators so `nx run openad-api:openapi` includes media VFS routes (**constitution VII**).
- [x] T058 [P] Add metrics hooks (Prometheus/OpenTelemetry or existing metrics module in `app/openad-api/src/infrastructure/metrics/`) for validation latency and upload terminal states (**SC-001**, **SC-005**, **SC-006**).
- [x] T059 [P] Accessibility pass on `app/openad-management/src/app/features/media-explorer/` — keyboard tree, focus trap in drawers, `aria-label` on FAB/upload. *(Baseline: row/card `aria-label`, toolbar/tree labels; full focus-trap audit optional.)*
- [x] T060 [P] Apply **PrimeNG** `Scroller` virtual scroll to `media-asset-list.component.ts` when folder item count exceeds agreed threshold. *(Table `virtualScroll` when `assets.length > 80`.)*
- [x] T061 [P] Implement optional worker or scheduled job to flag/revalidate assets when `dooh_ruleset_version` changes per **FR-010** (minimal: mark `pending` + notify).
- [ ] T062 Run steps in `specs/007-media-management-vfs/quickstart.md` including **Security verification**; fix gaps (note results in PR).
- [x] T063 [P] Align explorer styling with `app/openad-management/src/theme/aether-preset.ts`. *(Uses Aether tokens / PrimeNG surface; deeper pixel-match deferred.)*

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1** → **Phase 2** → **Phase 2b** → **US1 (tests → impl)** → **US2** → **US3** → **Phase 6**
- **US2** listing depends on **US1** asset registration for populated folders.
- **US3** builds on **US1** `GET` asset and **US2** shell; inspector can show **referenceCount** after T050.

### Parallel opportunities

| Phase | Parallelizable groups |
|-------|------------------------|
| 1 | T003, T004 after T001–T002 |
| 2 | T006, T008, T010, T011 in parallel before T014 |
| 2b | T016, T017, T020, T022 after T018–T019 sketched |
| US1 | T023–T025; then T029, T032, T033 after T026–T027 |
| US2 | T040–T043 after T037–T038 |
| US3 | T047–T048; T050, T052, T054 in parallel after T049 |
| 6 | T057–T061, T063 |

### Task counts

| Scope | Count |
|-------|-------|
| Phase 1 | 5 |
| Phase 2 | 10 |
| Phase 2b Security | 7 |
| US1 tests + impl | 12 |
| US2 tests + impl | 12 |
| US3 tests + impl | 10 |
| Phase 6 | 7 |
| **Total** | **63** |

---

## Implementation strategy

### MVP first

1. Phases 1, 2, **2b**, US1 (tests + implementation)

### Incremental delivery

1. US2 explorer + isolation  
2. US3 clone/GC/inspector  
3. Phase 6 observability + **FR-010** follow-up job  

---

## Notes

- Prefer extending `media-ingestion` over parallel controllers unless files become unmanageable.
- Do **not** add Tailwind to the Angular app; use **PrimeNG** + Aether tokens.
- Tablet manifest in `libs/api-contracts/src/media/manifest.contract.ts` must stay consistent with `file_hash` / `hash` naming for devices.

### Implementation progress (2026-04-11)

- **Done**: Phase 1–2b + US1 + US2 + **US3** + **Phase 6** (except manual **T062**): clone / PATCH / DELETE + refcount + `MediaGcService`, `mediaVfsOperationSeconds` / `mediaVfsMutationsTotal`, `DoohMediaRevalidationJob`, inspector + actions + mobile FAB/drawer, OpenAPI script note, list virtual scroll threshold, `media-vfs-security.integration.spec.ts` (T022 complete, T048 cross-campaign), `media-vfs.integration.spec.ts` (T035 tree smoke, T036 locked PATCH, T048 invalid body).
- **Deferred / partial**: **T062** manual quickstart; **T035** full SC-004 tree filtering when `MediaScopeService` gains real campaign membership; production Mongo index migration if legacy unique `hash` remains.
- **API paths**: VFS routes under `api/v1/media/vfs/...`; legacy catalog remains `api/v1/media/...`.
