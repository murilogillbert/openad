# Implementation Plan: Geospatial Intelligence & Triggering Engine

**Branch**: `005-geospatial-triggering-engine` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/005-geospatial-triggering-engine/spec.md`

## Summary

This feature adds a **geospatial intelligence and triggering** layer on top of the existing media/manifest pipeline (004): operators define **circle and polygon zones** with **tiers, priorities, and trigger rules**; the API packages a **spatial manifest** for each device; tablets run a **local geofence monitor** with **entry/dwell** logic, **tier-first arbitration**, **within-tier scoring** (pacing, distance, heading), **rotation**, **hysteresis**, **cooldowns**, and **velocity gates**. **Adaptive GPS sampling**, **smoothing**, and **dead reckoning** reduce noise and power use. A **geospatial ledger** captures **spatial receipts**, **zone residency**, and **lost-opportunity** events for analytics.

Technical approach: extend **NestJS** APIs and MongoDB models for zones and ledger events; extend **manifest generation** with an additive `spatial` section validated by **Zod** in `libs/api-contracts`; extend **mqtt-contracts** for batched ledger telemetry; implement tablet services in **Angular/Capacitor** with local persistence for cooldowns and deterministic tests for the state machine.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20 LTS  

**Primary Dependencies**:

- **Backend**: NestJS 11, Mongoose, existing manifest & media modules, Turf (or equivalent) for polygon tests, haversine for radial zones
- **Tablet**: Angular 21, Capacitor 8, Geolocation APIs, IndexedDB (or existing storage) for edge cooldown store
- **Management**: Angular 21 (openad-management) for zone CRUD and weights
- **Shared**: Zod 4 in `libs/api-contracts`, MQTT payload types in `libs/mqtt-contracts`

**Storage**:

- **MongoDB**: Spatial zone definitions, spatial ledger collections (receipts, residency intervals, lost-opportunity events)
- **Redis**: Optional cache for hot manifest fragments (follow existing manifest caching patterns)
- **Tablet**: Local KV/IDB for last-played / cooldown timestamps

**Testing**:

- **Backend**: Jest — unit tests for geometry evaluation, tier gating, manifest serialization; integration tests for manifest + spatial payload
- **Tablet**: Vitest — pure functions for scoring, rotation, dwell timers, shadow queue; replay fixtures for coordinates
- **E2E**: Playwright (management) for zone authoring smoke; field tests for GPS (manual / beta)

**Target Platform**: Linux API servers; Android tablets (Capacitor); web management portal  

**Project Type**: Nx monorepo — distributed API + mobile client + admin web  

**Performance Goals**:

- Spatial section generation adds **&lt;50ms p95** to existing manifest build for ≤200 spatial entries (measure; tune if exceeded)
- Tablet geofence evaluation cycle **&lt;16ms** median on mid-range Android when fed smoothed points at ≤1 Hz idle / 1–2 Hz moving
- Ledger batches **≤100KB** typical; upload on connectivity as with existing telemetry

**Constraints**:

- **Offline-first**: No server call per GPS fix (FR-004)
- **Backward compatible**: Clients that do not understand `spatial` ignore it; contract versioning via `spatial.version`
- **Battery**: Adaptive polling bounds configurable; default stationary **60s**, moving **1–2s** per spec assumptions

**Scale/Scope**:

- Thousands of devices; hundreds of overlapping zones nationally; ledger write volume proportional to fleet size — use batching and indexes on `deviceId`, `zoneId`, `ts`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with each principle from `.specify/memory/constitution.md`:

- [x] **I. KISS** — Reuse 004 manifest delivery and telemetry paths; add one spatial subsection and focused services rather than a second orchestration system.
- [x] **II. DRY** — Single Zod schema for spatial manifest; shared geometry helpers for API and tests; avoid duplicating tier logic between server preview and tablet (document authoritative tier on tablet for playback).
- [x] **III. SOLID** — Separate modules: `SpatialZone` persistence, `SpatialManifestBuilder`, tablet `GeofenceMonitor` vs `SpatialArbitrationEngine` vs `LocationPipeline` (SRP); depend on abstractions for geometry strategy (circle vs polygon).
- [x] **IV. YAGNI** — No full GIS editor v1 beyond CRUD + map; no Kalman fusion until metrics demand (per research.md).
- [x] **V. TDA** — Zone entities carry validation; state machine encapsulates inside/outside/dwelling; scoring functions take immutable snapshots.
- [x] **VI. TDD** — Tests first for geometry membership, tier filter, dwell timer, cooldown store, manifest JSON shape.
- [x] **VII. Enterprise Quality** — Structured logging on manifest spatial build and ledger ingest; PII/geo data handling documented; API version additive (minor); security review for zone creation authz.
- [x] **VIII. Clean Code** — Intention-revealing names (`SpatialArbitrationEngine`, `HysteresisBuffer`); short pure functions for score terms.

> **Post-design re-check**: Phase 1 artifacts (`research.md`, `data-model.md`, `contracts/`) introduce no unjustified complexity. Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/005-geospatial-triggering-engine/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── spatial-manifest.md
└── tasks.md             # Phase 2 (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
app/openad-api/src/
├── modules/
│   ├── geo-zones/                    # EXTEND or NEW: spatial zone CRUD, validation
│   │   ├── schemas/spatial-zone.schema.ts
│   │   ├── spatial-zone.service.ts
│   │   └── spatial-zone.controller.ts
│   ├── manifest/
│   │   ├── generators/
│   │   │   └── manifest-generator.service.ts   # EXTEND: emit spatial section
│   │   └── evaluators/
│   │       └── spatial-geometry.util.ts          # NEW: circle + polygon tests
│   └── impressions/ or reporting/              # EXTEND/NEW: ledger ingest endpoints if HTTP fallback
│
libs/api-contracts/src/
└── spatial/
    └── spatial-manifest.contract.ts              # NEW: Zod spatial manifest

libs/mqtt-contracts/src/
└── spatial-ledger.contract.ts                    # NEW: receipt / lost_op / residency batches

app/openad-ad-client/src/app/
├── features/
│   ├── geo/                                      # NEW feature area (name TBD)
│   │   ├── services/
│   │   │   ├── geofence-monitor.service.ts
│   │   │   ├── spatial-arbitration-engine.service.ts
│   │   │   ├── location-pipeline.service.ts      # smoothing, adaptive poll, DR
│   │   │   ├── shadow-queue.service.ts
│   │   │   └── spatial-cooldown-store.service.ts
│   │   └── models/spatial-state.model.ts
│   ├── playback/
│   │   └── services/playback-engine.service.ts # EXTEND: integrate arbitration output
│   └── sync/
│       └── models/manifest-api.model.ts         # EXTEND: spatial typing
│
app/openad-management/src/app/
├── geo-zones/ or campaigns/                    # EXTEND: map + zone editor, weights
│   └── ...
```

**Structure Decision**: Work stays inside the existing **openad-api**, **openad-ad-client**, **openad-management**, and **libs/** packages — no new Nx applications. This matches KISS and the monorepo layout established in 004.

## Complexity Tracking

> No constitution violations requiring justification.
