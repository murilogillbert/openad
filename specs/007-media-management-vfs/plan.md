# Implementation Plan: Media Management Module

**Branch**: `007-media-management-vfs` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/007-media-management-vfs/spec.md` plus planning notes: **Frontend UI/UX Architecture** (3-pane explorer, responsive mobile), **ingestion/validation**, **auto-provisioned roots**, **soft-copy documents**, **two-phase GC**.

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Deliver a **Media Management** experience in the management web app: a **three-pane, cloud-explorer-style UI** (navigation tree, main explorer with upload and view modes, inspector) with a **responsive mobile** variant (drawer, condensed navigation, bottom-sheet inspector, FAB). Backend flows: **client pre-flight validation**, **presigned direct-to-S3 multipart upload**, **post-upload registration** with **server-side metadata extraction** (e.g. FFmpeg worker) and **DOOH validation**, **MongoDB-backed folder tree** with **materialized paths** and **single-query subtree fetch**, **system root folders** and **campaign folder auto-provisioning** from `CampaignCreated` / rename workers, **soft-copy** via **cloned `media_assets` rows** sharing **`storage_key`** and **`file_hash`**, and **two-phase deletion** (remove catalog row → orphan check → conditional S3 delete).

Design artifacts: [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md), [contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20 LTS  
**Primary Dependencies**: Nx, NestJS 11 (`app/openad-api`), Angular 21 + PrimeNG + SSR (`app/openad-management`), Zod (`libs/api-contracts`), Mongoose/MongoDB driver, AWS SDK (S3 presigned URLs / delete), client multipart upload (e.g. `@aws-sdk/lib-storage` or equivalent)  
**Storage**: MongoDB (catalog: folders + `media_assets` documents), Amazon S3 (or compatible) for object bytes  
**Testing**: Jest via Nx (`nx test openad-api`, `nx test openad-management`, `nx test api-contracts`), lint via workspace ESLint  
**Target Platform**: Linux-hosted API; management UI — modern evergreen browsers + responsive breakpoints for tablet/phone  
**Project Type**: Nx monorepo — REST API + Angular web app + shared contract libraries  
**Performance Goals**: Tree load p95 &lt; 2s for typical campaign subtree; explorer list/grid interactive while background uploads progress; upload throughput bounded by client/network (server avoids binary proxying)  
**Constraints**: No binary streaming through API for uploads; DOOH validation before “approved” state; system folders non-destructible; least-privilege campaign isolation  
**Scale/Scope**: High-density concurrent uploads; many logical placements per physical object via shared `storage_key`; GC must remain correct under concurrent deletes  

## Security & trust model

- **Authorization first**: Every media VFS endpoint resolves the caller’s permitted campaigns (or org scope) before returning or mutating `folder_id` / asset ids — **no “add guards later”**; integration tests prove cross-campaign denial (**SC-004**).
- **Presigned uploads**: Short-lived credentials; server-issued `storage_key` is namespaced (tenant/org prefix) and bound to the upload session; **`complete`** verifies the object exists and matches expected size / conditions before creating a catalog row (**FR-011**).
- **Garbage collection**: `DeleteObject` only for keys under the product’s namespace; refcount zero after atomic catalog checks (**defense in depth**).
- **Secrets**: API never returns long-lived cloud credentials to the client — only session-scoped upload descriptors.

## Observability & performance

- **Structured logs** (existing logger module): upload `sessionId`, `storage_key` prefix, terminal state, validation phase timings — supports **SC-001**, **SC-005**, **SC-006**.
- **Metrics (recommended)**: Histogram or summary for “upload initiated → validation result shown” latency; counters for upload outcomes — enables proving **SC-001**/**SC-005** in staging.
- **UI responsiveness**: Progress UI for concurrent uploads; virtualized lists for large folders (PrimeNG `Scroller` when needed).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with each principle from `.specify/memory/constitution.md`:

- [x] **I. KISS** — One explorer layout pattern (tree + list/grid + inspector); soft copy modeled as duplicate rows + shared storage key (no separate graph DB). Complexity (multipart, workers) justified by scale and “no binary through API.”
- [x] **II. DRY** — Folder path rules, validation limits, and upload orchestration live in dedicated services; UI uses shared layout shell and reusable explorer primitives.
- [x] **III. SOLID** — Nest modules for media/folders/upload/GC; Angular feature folder with presentational vs container split; contracts in `api-contracts`.
- [x] **IV. YAGNI** — Scope tied to spec + stated UI/backend flows; no extra sync protocol beyond reference/hash identity for tablets (reuse existing manifest patterns where applicable).
- [x] **V. TDA** — Domain services own folder provisioning, registration, refcount/GC; not “fat controllers.”
- [x] **VI. TDD** — [tasks.md](./tasks.md) includes explicit **test tasks before or alongside** the implementation tasks they verify (Zod contracts, upload completion, scope/GC). Red-Green-Refactor is mandatory for merge; feature work is not “test-last.”
- [x] **VII. Enterprise Quality** — Structured logging on upload/GC/workers; explicit errors; version API/contracts; security on presigned URLs (TTL, content-type, size caps); document public HTTP surface in `contracts/`.
- [x] **VIII. Clean Code** — Intention-revealing names (`storageKey`, `fileHash`, `isSystemLocked`); small functions for tree mapping and refcount queries.

> Fill the Complexity Tracking table below for any violations that are unavoidable.

## Project Structure

### Documentation (this feature)

```text
specs/007-media-management-vfs/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
app/openad-api/
├── src/
│   ├── modules/                    # Nest feature modules (media, folders, upload, campaigns integration)
│   ├── workers/ or jobs/         # FFmpeg metadata, campaign folder rename, deferred GC
│   └── ...
└── test/ or *.spec.ts

app/openad-management/
├── src/app/
│   ├── pages/                    # e.g. media-explorer.page.ts (route)
│   ├── features/media-explorer/  # 3-pane layout, tree, grid/list, inspector, mobile shell
│   └── shared/
└── *.spec.ts

libs/api-contracts/
├── src/media/                    # Extend: VFS types, upload completion, folder DTOs (Zod)
└── ...

libs/domain/                      # Optional shared domain types if used by API + contracts
```

**Structure Decision**: Implement API in `app/openad-api` Nest modules; management UI in `app/openad-management` under a dedicated **media explorer** feature route; share request/response and manifest-related shapes via `libs/api-contracts` (Zod), consistent with existing `libs/api-contracts/src/media/media-asset.contract.ts`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_ | — | — |

## Post-Design Constitution Re-check

After Phase 1: design still satisfies KISS/YAGNI — **multipart + worker + refcount** are the minimal set for stated non-functional goals (no API binary proxy, correct storage billing, safe deletes). Contracts and `data-model.md` are the single sources of truth for field names and transitions.

**Post–task-generation update (analysis remediation)**: Security and trust boundaries, observability hooks, and **TDD-aligned task ordering** are captured in [tasks.md](./tasks.md); `spec.md` adds **FR-011**, **FR-012**, and **SC-006** for catalog integrity, deduplication policy, and verifiable SLO evidence.
