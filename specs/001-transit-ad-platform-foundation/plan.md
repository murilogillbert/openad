# Implementation Plan: End-to-End Media Orchestration Platform for Transit Advertising — System Foundation

**Branch**: `001-transit-ad-platform-foundation` | **Date**: 2026-04-04 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-transit-ad-platform-foundation/spec.md`

---

## Summary

Transform a fleet of Android tablets installed in ride-hailing vehicles into a high-precision, geographically aware digital advertising network. The system covers four foundational pillars: (1) **Inventory Activation** — secure tablet-to-vehicle binding creating a managed device catalog; (2) **Contextual Delivery** — geo-zone + time-window based schedule evaluation with offline-capable content pre-positioning via MQTT; (3) **Fleet Intelligence** — real-time dashboard with heartbeat monitoring, alert detection, and remote command dispatch; (4) **Commercial Accountability** — immutable impression event recording and Proof-of-Play report generation.

**Technology stack** (user-specified): MQTT 5.0 (EMQX broker) for device communication, MongoDB 7.x as primary database with 2dsphere geo-indexing, Redis 7.x for message queuing (Streams) and hot-data caching, PrimeNG 17+ as the Angular UI component library, Tailwind CSS 3.x for layout and design system utilities.

---

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS — backend), TypeScript 5.x (Angular 17 — frontend)  
**Primary Dependencies**: NestJS (backend framework), Angular 17, PrimeNG 17, Tailwind CSS 3, EMQX 5.x (MQTT broker), BullMQ (background jobs), Socket.io (WebSocket — dashboard real-time)  
**Storage**: MongoDB 7.x (primary), Redis 7.x (queues + cache)  
**Testing**: Jest (unit + integration), Playwright (E2E)  
**Target Platform**: Linux server (backend + broker), Android tablet (device client), Web browser (portal)  
**Project Type**: Web service (REST API) + Event-driven system (MQTT) + Web application (Angular SPA)  
**Performance Goals**:
- 10,000 concurrent MQTT connections (SC-010)
- ≥ 50,000 impression events/minute ingestion
- ≤ 30s fleet status staleness (SC-002)
- ≤ 5 min Proof-of-Play report generation (SC-007, SC-010)
- ≤ 5 min remote command acknowledgement (SC-005)

**Constraints**: Devices operate under unreliable mobile data; 72-hour offline resilience required (SC-003); impression events must never be silently discarded (SC-006); no passenger profiling data collected  
**Scale/Scope**: ≥ 10,000 concurrently active vehicles; single metropolitan area (v1)

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- [x] **I. KISS** — Each service has exactly one responsibility. No speculative abstractions. Redis is used only where its properties are specifically needed (queues, pub/sub, hot cache). One broker, one database, no fan-out to secondary stores for v1.
- [x] **II. DRY** — Shared `libs/domain` package owns entity type definitions. `libs/mqtt-contracts` owns topic schemas reused by both the backend and the Android device SDK documentation. Rest API types are generated from a single OpenAPI spec.
- [x] **III. SOLID** — Each NestJS module has a single domain responsibility (Devices, Campaigns, Fleet Monitor, Impressions, Reporting). Repository pattern isolates DB access behind interfaces. All dependencies injected via NestJS DI container. No module imports another module's repository directly.
- [x] **IV. YAGNI** — Multi-market operations, mobile campaign management app, passenger biometric reach measurement, external OBD GPS integrations, and secondary analytics stores are explicitly deferred. Every designed element traces to a current FR or SC.
- [x] **V. TDA** — State transition logic (Device binding, Campaign lifecycle, Command queue drain) lives inside domain service classes, not in controller handlers or in the Angular frontend. Impression immutability is enforced by the Impression Service, not by caller convention.
- [x] **VI. TDD** — All NestJS service classes will have failing unit tests written before implementation. Integration tests for each MQTT → Redis → MongoDB flow are written before the infrastructure adapters. Playwright E2E tests for all 4 user story journeys written before final UI wiring. Red-Green-Refactor strictly enforced.
- [x] **VII. Enterprise Quality** — JWT auth with refresh tokens; TLS 1.3 + device cert pinning for MQTT; structured logging (Pino) on all service operations and error paths; OpenAPI-generated client SDK; semver on API version; security checklist entry required for every auth/IO touch point (Device binding, Asset upload, Impression ingestion, Report export).
- [x] **VIII. Clean Code** — Module names are intention-revealing (`DeviceBindingService`, `ImpressionIngestionWorker`, `GeoScheduleEvaluator`). Functions stay single-purpose. QoS level choices document *why* in comments (why QoS 0 for telemetry vs. QoS 2 for impressions). No dead code committed.

**Result**: ✅ All 8 constitution principles pass. No violations to justify.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-transit-ad-platform-foundation/
├── plan.md              ← This file
├── research.md          ← Phase 0 output (technology decisions + rationale)
├── data-model.md        ← Phase 1 output (MongoDB collections + indexes)
├── quickstart.md        ← Phase 1 output (developer onboarding + core flows)
├── contracts/
│   ├── rest-api.md      ← Phase 1 output (REST API contract, all endpoints)
│   └── mqtt-topics.md   ← Phase 1 output (MQTT topic schema contract)
└── tasks.md             ← Phase 2 output (/speckit.tasks — NOT yet created)
```

### Source Code (repository root)

```text
openad/
├── apps/
│   ├── api/                         # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/            # JWT login, refresh, RBAC guard
│   │   │   │   ├── devices/         # Device binding, managed identity
│   │   │   │   ├── vehicles/        # Vehicle catalog, decommission
│   │   │   │   ├── campaigns/       # Campaign CRUD, lifecycle
│   │   │   │   ├── geo-zones/       # GeoJSON zone management
│   │   │   │   ├── schedule-rules/  # Rule creation, conflict resolution
│   │   │   │   ├── fleet-monitor/   # Heartbeat processing, alert detection
│   │   │   │   ├── impressions/     # Event ingestion, dedup, MongoDB write
│   │   │   │   └── reporting/       # Proof-of-Play, billing summary, export
│   │   │   ├── infrastructure/
│   │   │   │   ├── mqtt/            # EMQX client, topic handlers, QoS routing
│   │   │   │   ├── redis/           # Streams producer/consumer, pub/sub, cache
│   │   │   │   └── mongodb/         # Mongoose schemas, repository base classes
│   │   │   └── main.ts
│   │   └── test/
│   │       ├── unit/                # Jest: service-level tests (mock repos + MQTT)
│   │       ├── integration/         # Jest: MQTT → Redis → service → MongoDB flow
│   │       └── contract/            # Consumer-driven contract tests (topic schemas)
│   │
│   └── portal/                      # Angular 17 SPA
│       ├── src/
│       │   ├── app/
│       │   │   ├── inventory/        # Device binding UI, vehicle catalog (PrimeNG Table)
│       │   │   ├── campaigns/        # Campaign wizard, asset upload, rule builder
│       │   │   ├── geo-zones/        # Zone draw UI (PrimeNG Map / Leaflet)
│       │   │   ├── dashboard/        # Mission Control live map, fleet status, commands
│       │   │   ├── reports/          # Proof-of-Play reports, billing export
│       │   │   └── shared/           # Auth, layout, notification components
│       │   └── environments/
│       └── e2e/                      # Playwright: 4 primary user journey tests
│
├── libs/
│   ├── domain/                      # Shared TypeScript interfaces for all entities
│   ├── mqtt-contracts/              # MQTT topic payload schemas (Zod validation)
│   └── api-contracts/               # Generated from OpenAPI; shared types
│
└── specs/
    └── 001-transit-ad-platform-foundation/
```

**Structure Decision**: Nx monorepo with `apps/` + `libs/` structure chosen to enable shared domain types between the API and portal without duplication (DRY principle). NestJS module-per-domain enforces SRP. Playwright e2e lives in `apps/portal/e2e/` co-located with the application under test.

---

## Phase 0: Research — Summary

Full details in [research.md](./research.md). Key decisions:

| Area | Decision | Key Rationale |
|---|---|---|
| Device protocol | MQTT 5.0 (EMQX broker) | Designed for unreliable networks; QoS 2 for impressions (no silent drops) |
| Database | MongoDB 7.x | Native GeoJSON 2dsphere indexing for geo-zone queries; flexible document model for heterogeneous vehicle characteristics |
| Queue/Cache | Redis 7.x (Streams + pub/sub + KV) | Event pipeline (Streams), dashboard push (pub/sub), schedule cache (KV) |
| Frontend | Angular 17 + PrimeNG 17 + Tailwind 3 | User-specified; covers all required admin UI components (DataTable, Map, Charts) |
| Backend framework | NestJS | TypeScript-first, DI container, MQTT module available, aligns with Angular team skillset |
| Background jobs | BullMQ (Redis-backed) | Report generation and asset propagation jobs need reliable, retryable async execution |
| MQTT broker (production) | EMQX 5.x | Handles 1M+ concurrent connections; open-source; cluster-ready |

---

## Phase 1: Design Artifacts

All generated in this phase:

| Artifact | Path | Purpose |
|---|---|---|
| Data Model | [data-model.md](./data-model.md) | MongoDB collections, fields, indexes, state machines for all 9 entities |
| REST API Contract | [contracts/rest-api.md](./contracts/rest-api.md) | All REST endpoints, request/response schemas, roles, error codes |
| MQTT Contract | [contracts/mqtt-topics.md](./contracts/mqtt-topics.md) | All MQTT topics, QoS levels, payload schemas, error handling |
| Quickstart | [quickstart.md](./quickstart.md) | Repository structure, 4 core flows, key design decisions, constitution compliance |

### Post-Design Constitution Re-Check

After Phase 1 design, constitution alignment confirmed:

- **KISS**: No additional complexity introduced — data model is the minimum necessary to support all 27 FRs. No premature indexes or collections.
- **DRY**: `ImpressionEvent` entity reuses `GeoZone` zone IDs (no geo data duplication). `ScheduleRule` stores references, not copies, of assets and zones.
- **SOLID**: `fleet_status` collection is append-upsert only — separation of "current state" from "historical event log" keeps each collection single-purpose.
- **YAGNI**: No analytics pre-aggregation tables added. MongoDB aggregation pipelines serve the ≤5min report SLA without a dedicated analytics store.
- **TDA**: State transition rules documented in data-model.md live in the domain service layer, not enforced by callers.
- **TDD**: Contract files define exact schemas → contract tests will validate these before service implementation begins.
- **Enterprise Quality**: Every MQTT topic payload has a `ts` (timestamp) and device-generated `eventId` for full traceability. TLS + cert pinning documented in MQTT contract.
- **Clean Code**: Entity names (`impression_events`, `fleet_status`, `remote_commands`, `schedule_rules`) are unambiguous, consistent, and match the spec's vocabulary.

**Result**: ✅ Constitution re-check passes. No complexity tracking entries required.

---

## Complexity Tracking

> No constitution violations in this plan. This table is intentionally empty.

---

## Next Step

Run `/speckit.tasks` to generate the dependency-ordered task breakdown for implementation.
