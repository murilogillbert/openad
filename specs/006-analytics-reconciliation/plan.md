# Implementation Plan: Analytics & Reconciliation Engine

**Branch**: `006-analytics-reconciliation` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/006-analytics-reconciliation/spec.md`

## Summary

This feature delivers an **analytics and reconciliation pipeline** from **tablet (edge)** to **core**: each **play** is an **immutable, high-fidelity record** (time range, GPS start/end, device, vehicle, campaign, trigger reason, environment snapshot, unique event identity). The edge **buffers** plays locally, **batches** and **compresses** uploads; the API **accepts batches quickly** and **defers** heavy work to **async workers**. **Reconciliation** deduplicates by event identity, validates **duration** vs asset length, **re-verifies geofences**, and drives **billable impressions**, **reach**, and **revenue lines**. **Fraud/integrity** rules (heartbeat density, implied GPS velocity, blackout/display-off) flag or discard records. **Pacing** emits a signal when daily budget utilization crosses **~95%** so the **manifest / scheduling** path can lower priority on the next sync.

Technical approach: **Zod** contracts in `libs/api-contracts` (and optional `libs/mqtt-contracts` for cross-refs); **NestJS** module(s) for ingest HTTP, enqueue **BullMQ** jobs (Redis, existing `QueuesModule` pattern), **MongoDB** for durable play records and aggregates (v1); **Capacitor** + **SQLite** (or equivalent) on tablet for offline buffer; extend **manifest** or campaign services for pacing hooks. Reporting queries may use **MongoDB aggregation** first; **Timescale/ClickHouse** deferred until volume warrants (see `research.md`).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20 LTS  

**Primary Dependencies**:

- **Backend**: NestJS 11, Mongoose, BullMQ (`@nestjs/bullmq`), existing `QueuesModule`, Redis, optional RabbitMQ (already in stack for MQTT; not required for v1 ingest path if BullMQ suffices)
- **Tablet**: Angular 21, Capacitor 8, `@capacitor-community/sqlite` or Capacitor **Filesystem + SQLite** for durable play buffer; `pako` or Web **CompressionStream** for gzip when available
- **Management**: Angular 21 — campaign analytics dashboards consuming reporting APIs
- **Shared**: Zod 4 in `libs/api-contracts`

**Storage**:

- **MongoDB**: Raw play records (append-only), reconciliation outcomes, audit/fraud flags, daily rollups (materialized or computed)
- **Redis**: BullMQ job queues; optional dedupe **SET** keys with TTL for idempotency acceleration
- **Tablet**: SQLite (or Room-equivalent) for pending plays + upload state

**Testing**:

- **Backend**: Jest — unit tests for reconciliation rules (dedupe, duration, geofence, fraud thresholds); integration tests for batch ingest → job → persisted state
- **Tablet**: Vitest — pure functions for hash generation, batch assembly, gzip round-trip (where applicable)
- **Contract**: Zod round-trip tests for play record and batch payloads

**Target Platform**: Linux API servers; Android tablets (Capacitor); web management  

**Project Type**: Nx monorepo — API + mobile client + admin web + shared libs  

**Performance Goals**:

- Ingest **HTTP handler** completes in **&lt;200ms p95** for compressed batch accept (enqueue only; no full reconciliation inline)
- Reconciliation worker processes **≥ N** plays/sec per instance (baseline TBD in load test; start with 100+ plays/sec on dev hardware)
- Tablet flush: **50–100** plays per batch; backoff on failure

**Constraints**:

- **Idempotent** ingestion (same `uniqueEventId` + `deviceId` must not double-bill; matches contract and `data-model.md`)
- **Lossless** compression (gzip) — verify decompress before parse
- **PII / location**: follow existing fleet audit and data-handling patterns

**Scale/Scope**:

- Fleet-wide concurrent uploads at rush hour — horizontal scale of API + workers; MongoDB indexes on `(deviceId, uniqueEventId)`, `(campaignId, timestampStart)`, `(vehicleId, campaignId)` (field names per `data-model.md`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with `.specify/memory/constitution.md`:

- [x] **I. KISS** — One ingest path (HTTP batch → queue → workers); reuse Redis/Mongo/BullMQ already in repo; avoid a second analytics stack until metrics demand OLAP.
- [x] **II. DRY** — Single Zod schema for play record and batch; one geofence verification path shared with geo-zone/manifest sources of truth.
- [x] **III. SOLID** — Ingest controller (thin), `PlaybackBatchIngestService`, `ReconciliationService`, `FraudDetectionService`, reporting aggregation service (SRP); strategy for trigger-reason-specific rules where needed.
- [x] **IV. YAGNI** — No ClickHouse/Timescale until Mongo aggregation proven insufficient; no per-play HTTP from tablet.
- [x] **V. TDA** — Play record aggregate encapsulates validation transitions; avoid anemic DTO-only flows without domain classification.
- [x] **VI. TDD** — Tests first for dedupe, partial play exclusion, geofence mismatch, velocity fraud, heartbeat ratio.
- [x] **VII. Enterprise Quality** — Structured logging, correlation IDs on batch ingest, idempotent job handling, authz on reporting routes.
- [x] **VIII. Clean Code** — Explicit enums for trigger reason and reconciliation outcome; named thresholds for fraud.

> **Post-design**: Phase 1 artifacts align with above. No mandatory Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/006-analytics-reconciliation/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── playback-play-record.md
└── tasks.md             # Phase 2 (/speckit.tasks)
```

### Source Code (repository root)

```text
libs/api-contracts/src/
├── analytics/                    # NEW: play record + batch Zod schemas, exports
│   └── playback-play-record.contract.ts
└── index.ts                      # EXTEND: barrel exports

app/openad-api/src/
├── modules/
│   ├── analytics/                # NEW (or analytics-playback/)
│   │   ├── analytics.module.ts
│   │   ├── playback-batch.controller.ts    # POST batch ingest (device JWT or fleet auth)
│   │   ├── playback-batch-ingest.service.ts  # validate, enqueue
│   │   ├── processors/
│   │   │   └── analytics-reconciliation.processor.ts  # BullMQ worker (queue name `analytics-reconciliation`)
│   │   ├── services/
│   │   │   ├── reconciliation.service.ts
│   │   │   ├── fraud-detection.service.ts
│   │   │   ├── reporting-aggregation.service.ts
│   │   │   └── pacing-signal.service.ts      # FR-012 → manifest/campaign hook
│   │   └── schemas/
│   │       └── play-record.schema.ts
│   └── manifest/                 # EXTEND: consume pacing signals or campaign priority
│       └── ...
├── infrastructure/queues/
│   └── queues.module.ts            # EXTEND: register `analytics-reconciliation` queue

app/openad-ad-client/src/
├── app/features/
│   ├── playback/                 # EXTEND: emit play records on play complete
│   └── analytics/                # NEW: local SQLite buffer, batch flush scheduler
│       ├── services/
│       │   ├── play-record-buffer.service.ts
│       │   └── play-batch-uploader.service.ts
│       └── ...

app/openad-management/src/
└── app/                          # NEW or EXTEND: campaign analytics views (P3)
```

**Structure Decision**: Add **`libs/api-contracts`** analytics types; new **`app/openad-api`** `analytics` module for ingest + workers; tablet **`analytics`** feature for SQLite buffer and uploader; management UI can follow in same feature or a thin slice after APIs exist.

## Complexity Tracking

> No constitution violations requiring justification for v1.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phases & deliverables

| Phase | Output | Status |
|-------|--------|--------|
| 0 | `research.md` — storage, queue, edge DB, compression | Done |
| 1 | `data-model.md`, `quickstart.md`, `contracts/playback-play-record.md` | Done |
| 2 | `tasks.md` via `/speckit.tasks` | Done |

## Dependencies on existing features

- **003 / 004**: Device identity, manifest sync, playback lifecycle (hook play completion → record).
- **005**: Geo-zone definitions for server-side geofence verification of play coordinates.
- **Campaigns / media**: Asset duration, campaign IDs, pricing multipliers (FR-011).
- **Fleet telemetry**: Heartbeat history for FR-013 correlation.
