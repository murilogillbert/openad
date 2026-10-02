# Implementation Plan: Media Orchestration & Manifest Pipeline

**Branch**: `004-media-orchestration-pipeline` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-media-orchestration-pipeline/spec.md`

## Summary

This feature implements a distributed media orchestration system that manages video advertisement distribution and playback across a fleet of Android tablets installed in vehicles. The system consists of three primary components:

1. **Media Ingestion Engine (API)**: Validates, sanitizes, and catalogs uploaded video files with content hashing and constraint enforcement
2. **Manifest Delivery Architecture (API)**: Generates device-specific manifests with delta-update optimization to minimize bandwidth
3. **Edge Synchronization & Playback Logic (Tablet)**: Autonomous file manager with resumable downloads, hash verification, and continuous playback with constraint-based filtering

The technical approach uses NestJS for the backend API with MongoDB storage, Angular/Capacitor for the Android tablet client, MQTT for real-time priority commands, and S3-compatible storage for media files with byte-range request support.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20 LTS  
**Primary Dependencies**: 
- **Backend**: NestJS 11, Mongoose (MongoDB driver), @nestjs/jwt, @aws-sdk/client-s3, mqtt, bullmq (job queue)
- **Frontend**: Angular 21, Capacitor 8, @capgo/capacitor-mqtt, RxJS 7
- **Shared**: Zod 4 (schema validation for contracts)

**Storage**: 
- **Database**: MongoDB (via Mongoose) for metadata (media assets, manifests, devices, campaigns)
- **File Storage**: S3-compatible object storage (AWS S3 or compatible) for video files with byte-range support
- **Cache**: Redis (via ioredis) for manifest caching and job queue (BullMQ)

**Testing**: 
- **Backend**: Jest 30 with mongodb-memory-server and redis-memory-server for integration tests
- **Frontend**: Vitest 4 (Angular unit tests) and Playwright (e2e tests)
- **Contract Testing**: Zod schema validation in libs/api-contracts

**Target Platform**: 
- **Backend**: Linux server (containerized with Docker)
- **Frontend**: Android 8+ tablets (Capacitor native wrapper)

**Project Type**: Distributed web service + mobile application (Nx monorepo)

**Performance Goals**: 
- Media ingestion: Process and hash files within 30 seconds for files up to 500MB
- Manifest generation: Generate device-specific manifests in <200ms
- Delta calculation: Process manifest diffs for 1000 devices in <5 seconds
- Concurrent synchronization: Support 1000 tablets requesting manifests simultaneously without degradation
- Download resumption: Resume interrupted downloads within 2 seconds of connectivity restoration

**Constraints**: 
- Video validation: Max bitrate 10 Mbps, max resolution 1920x1080, codecs H.264/H.265, max file size 500MB
- Tablet storage: Assume 2-5GB available for media (20+ ads)
- Network: Intermittent 3G/4G/5G connectivity with dead zones
- Bandwidth optimization: Delta updates must reduce bandwidth by 70% vs full manifest
- Playback continuity: Zero visible gaps or errors in 95% of journeys
- Hash verification: 100% of downloads verified before playback

**Scale/Scope**: 
- Fleet size: 1000+ tablets initially, scalable to 10,000+
- Media catalog: 500+ active ads at any time
- Manifest updates: Multiple times per day per device
- Concurrent downloads: 100+ tablets downloading simultaneously
- MQTT priority commands: Real-time delivery to targeted devices (<5s latency)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with each principle from `.specify/memory/constitution.md`:

- [x] **I. KISS** — The design uses established patterns (REST API, manifest-based sync, local-first playback) without unnecessary abstractions. Complexity is justified by distributed system requirements (eventual consistency, offline-first).
- [x] **II. DRY** — Shared contracts (Zod schemas) in libs/api-contracts and libs/mqtt-contracts eliminate duplication between API and clients. Media validation logic centralized in ingestion service.
- [x] **III. SOLID** — NestJS modules enforce SRP (auth, campaigns, devices separated). Manifest generation abstracted behind service interface (OCP/DIP). Tablet sync engine follows ISP with separate concerns for download, verification, playback.
- [x] **IV. YAGNI** — All components map to P1/P2 requirements. Geofence (P3) and time-based scheduling (P3) deferred to Phase 3. No speculative features included.
- [x] **V. TDA** — Media entities encapsulate validation logic. Manifest service owns delta calculation. Tablet sync engine manages its own state transitions (downloading → verifying → playing).
- [x] **VI. TDD** — Tests will be written first for all core logic: media validation, hash generation, manifest delta calculation, download resumption, playback loop logic. Integration tests for API endpoints and tablet sync flows.
- [x] **VII. Enterprise Quality** — Structured logging (nestjs-pino) for all operations. Error handling with specific error codes. API versioning (/v1/). Security: JWT auth, input validation (class-validator), file upload limits. Performance: Redis caching for manifests, BullMQ for async processing.
- [x] **VIII. Clean Code** — Intention-revealing names (ManifestDeltaCalculator, MediaIngestionService, SyncOrchestrator). Single-purpose functions. Comments explain "why" (e.g., "Delete lowest-priority ads to prevent storage exhaustion"). No dead code.

> No violations requiring justification. All complexity is essential for distributed system requirements.

## Project Structure

### Documentation (this feature)

```text
specs/004-media-orchestration-pipeline/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── api-endpoints.md
│   └── mqtt-messages.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Backend API (NestJS)
app/openad-api/src/
├── modules/
│   ├── media-ingestion/          # NEW: FR-001 to FR-008
│   │   ├── media-ingestion.module.ts
│   │   ├── media-ingestion.service.ts
│   │   ├── media-ingestion.controller.ts
│   │   ├── dto/
│   │   │   ├── upload-media.dto.ts
│   │   │   └── media-validation-error.dto.ts
│   │   ├── schemas/
│   │   │   └── media-asset.schema.ts
│   │   ├── validators/
│   │   │   ├── video-validator.service.ts
│   │   │   └── hash-generator.service.ts
│   │   └── storage/
│   │       └── s3-storage.service.ts
│   │
│   ├── manifest/                  # NEW: FR-009 to FR-014
│   │   ├── manifest.module.ts
│   │   ├── manifest.service.ts
│   │   ├── manifest.controller.ts
│   │   ├── dto/
│   │   │   ├── manifest-request.dto.ts
│   │   │   └── manifest-response.dto.ts
│   │   ├── schemas/
│   │   │   └── manifest.schema.ts
│   │   ├── generators/
│   │   │   ├── manifest-generator.service.ts
│   │   │   └── delta-calculator.service.ts
│   │   └── evaluators/
│   │       └── constraint-evaluator.service.ts
│   │
│   ├── priority-commands/         # NEW: FR-030 to FR-032 (MQTT)
│   │   ├── priority-commands.module.ts
│   │   ├── priority-commands.gateway.ts
│   │   └── dto/
│   │       └── priority-command.dto.ts
│   │
│   └── [existing modules: auth, campaigns, devices, etc.]
│
├── infrastructure/
│   └── storage/
│       └── s3.config.ts           # EXTEND: Add byte-range support config
│
└── test/
    ├── integration/
    │   ├── media-ingestion.integration.spec.ts
    │   ├── manifest-generation.integration.spec.ts
    │   └── priority-commands.integration.spec.ts
    └── unit/
        ├── video-validator.spec.ts
        ├── hash-generator.spec.ts
        ├── manifest-generator.spec.ts
        └── delta-calculator.spec.ts

# Tablet Client (Angular + Capacitor)
app/openad-ad-client/src/
├── app/
│   ├── features/
│   │   ├── sync/                  # NEW: FR-015 to FR-024
│   │   │   ├── sync.module.ts
│   │   │   ├── services/
│   │   │   │   ├── sync-orchestrator.service.ts
│   │   │   │   ├── download-manager.service.ts
│   │   │   │   ├── hash-verifier.service.ts
│   │   │   │   ├── storage-manager.service.ts
│   │   │   │   └── manifest-client.service.ts
│   │   │   └── models/
│   │   │       ├── sync-state.model.ts
│   │   │       └── download-progress.model.ts
│   │   │
│   │   ├── playback/              # NEW: FR-025 to FR-035
│   │   │   ├── playback.module.ts
│   │   │   ├── components/
│   │   │   │   ├── video-player/
│   │   │   │   └── playback-controller/
│   │   │   ├── services/
│   │   │   │   ├── playback-engine.service.ts
│   │   │   │   ├── loop-manager.service.ts
│   │   │   │   ├── constraint-filter.service.ts
│   │   │   │   └── priority-queue.service.ts
│   │   │   └── models/
│   │   │       ├── playback-state.model.ts
│   │   │       └── ad-queue.model.ts
│   │   │
│   │   └── mqtt/                  # NEW: Priority command receiver
│   │       ├── mqtt.module.ts
│   │       └── services/
│   │           └── mqtt-client.service.ts
│   │
│   └── core/
│       └── services/
│           └── device-info.service.ts  # EXTEND: GPS, speed reporting
│
└── capacitor/
    └── assets/
        └── factory-default-ads/   # NEW: Embedded default loop videos

# Shared Libraries
libs/api-contracts/src/
└── media/                         # NEW: API contracts for media & manifest
    ├── media-asset.contract.ts
    ├── manifest.contract.ts
    └── validation-constraints.contract.ts

libs/mqtt-contracts/src/
└── priority-command.contract.ts   # NEW: MQTT message schema

libs/domain/src/
└── media/                         # NEW: Shared domain models
    ├── media-asset.model.ts
    ├── manifest.model.ts
    └── constraint.model.ts
```

**Structure Decision**: This is a distributed system with three distinct deployment targets:

1. **Backend API** (`app/openad-api`): NestJS application handling media ingestion, manifest generation, and MQTT command dispatch
2. **Tablet Client** (`app/openad-ad-client`): Angular/Capacitor application running on Android tablets with offline-first architecture
3. **Shared Libraries** (`libs/`): Contract definitions and domain models shared between API and client

The structure follows Nx monorepo best practices with clear separation between applications and libraries. New modules are added to existing applications rather than creating new projects, maintaining simplicity while enforcing domain boundaries.

## Complexity Tracking

> **No violations to report** — all complexity is justified by distributed system requirements.
