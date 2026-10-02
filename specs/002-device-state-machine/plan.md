# Implementation Plan: Device State Machine and Configuration Profiles

**Branch**: `002-device-state-machine` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/002-device-state-machine/spec.md`

---

## Summary

Transform the OpenAD platform from a passive device registry into an active fleet management system by implementing:

1. **A formal 5-state device lifecycle machine** (`Pending → Active → Flagged → Suspended → Retired`) with automatic system transitions (heartbeat timeout, health threshold breaches) and admin-initiated transitions, backed by an immutable audit log.
2. **Configuration Profiles and Device Groups** — reusable rule sets (exhibition rules, connectivity modes, commercial CPM multipliers) assignable to logical fleet segments, with push-based propagation over existing MQTT infrastructure and a drag-and-drop UI in the Management App.
3. **Tablet self-awareness** — Capability Manifest reporting at pairing, intelligent LRU storage eviction before downloads, and power-aware playback suspension on detected engine-off.

---

## Technical Context

**Language/Version**: TypeScript 5.9 (Node 20 LTS for API; Angular 21 for Management App; Capacitor 8 / Android for Tablet App)  
**Primary Dependencies**: NestJS 11 (API), `@nestjs/schedule` (cron sweeps), `@nestjs/mongoose` + Mongoose 9 (persistence), BullMQ 5 + ioredis (async job queues), MQTT 5 (device messaging), Angular 21 + PrimeNG 21 + Angular CDK (Management App UI), Capacitor 8 (Tablet App shell)  
**Storage**: MongoDB (primary — all new collections); Redis (BullMQ job queues for async config propagation)  
**Testing**: Jest 30 (unit + integration); Playwright (e2e — Management App); `mongodb-memory-server` + `redis-memory-server` (integration test isolation)  
**Target Platform**: Linux server (API), modern browser (Management App), Android 10+ (Tablet App via Capacitor)  
**Project Type**: Multi-layer monorepo — NestJS web service + Angular SPA + Capacitor mobile app  
**Performance Goals**: State transitions complete in < 100ms (p95); config propagation to 100 devices in < 60s; heartbeat sweep completes in < 5s for fleets of 500 devices  
**Constraints**: Zero data loss on state transitions; all transitions must be idempotent (safe to retry); `Retired` blacklist lookups must be < 5ms (indexed); MQTT payload size < 4KB (heartbeat extended payload)  
**Scale/Scope**: 500–1,000 active devices; 50 device groups; 20 configuration profiles; 10,000+ lifecycle events per day  

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked post-design below.*

- [x] **I. KISS** — `DeviceStateMachineService` uses a hand-coded transition table (no FSM library) because the graph is static and small (5 states, 8 edges). Config profile propagation reuses existing MQTT infrastructure.
- [x] **II. DRY** — Health threshold constants extracted to `ConfigService` (one source of truth). Transition logic is in exactly one service (`DeviceStateMachineService`). Profile rules stored once in `ConfigurationProfile`, never copied to device records.
- [x] **III. SOLID** — SRP enforced: `DeviceStateMachineService` (transitions only), `HealthThresholdEvaluatorService` (metric evaluation only), `HeartbeatMonitorService` (scheduling + dispatch only), `ConfigurationProfilesService` (CRUD + cascade), `DeviceGroupsService` (membership + sync). DIP: services depend on repository abstractions, not Mongoose models directly.
- [x] **IV. YAGNI** — OBD-II voltage monitoring deferred (baseline: `ACTION_POWER_DISCONNECTED` intent). Multi-version manifest history deferred. Only the 5 states in the spec are implemented. No speculative states added.
- [x] **V. TDA** — `DeviceStateMachineService.transitionTo()` holds all transition logic; callers don't inspect state to decide. `HealthThresholdEvaluatorService.evaluate()` returns an action, not raw metric data for callers to act on.
- [x] **VI. TDD** — Every `DeviceStateMachineService` transition guard has a test written first. `HealthThresholdEvaluatorService` unit-tested against all threshold boundary values before implementation. Integration tests for heartbeat sweep use `mongodb-memory-server`.
- [x] **VII. Enterprise Quality** — All state transitions are structured-logged with `PinoLogger` (`event: 'device.state.transition'`). `RetiredDeviceGuard` validates UUID on every inbound request. `HEARTBEAT_FLAGGED_THRESHOLD_MS` and all health thresholds are `ConfigService` values. New REST endpoints are Swagger-documented and versioned under `/api/v1`.
- [x] **VIII. Clean Code** — `DeviceLifecycleState` replaces the ambiguous `DeviceStatus`. All new services have single-purpose methods. Transition trigger detail strings are descriptive constants (`'heartbeat_timeout'`, `'health_threshold:battery'`).

**Post-design re-check**: All gates pass. No violations requiring Complexity Tracking.

---

## Project Structure

### Documentation (this feature)

```text
specs/002-device-state-machine/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.md           # REST + MQTT + WebSocket contracts
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
libs/
├── domain/src/lib/entities.ts            # MODIFIED — new types + state enum migration
├── api-contracts/src/lib/types.ts        # MODIFIED — new REST request/response interfaces
└── mqtt-contracts/src/lib/              # MODIFIED — extended heartbeat + 2 new topics

app/openad-api/src/
├── modules/
│   ├── devices/
│   │   ├── device-state-machine.service.ts          # NEW — FSM core
│   │   ├── device-state-machine.service.spec.ts     # NEW — TDD first
│   │   ├── device-lifecycle-event.schema.ts         # NEW — audit log schema
│   │   ├── device-lifecycle-event.repository.ts     # NEW
│   │   ├── retired-device-registry.schema.ts        # NEW — blacklist schema
│   │   ├── retired-device-guard.ts                  # NEW — NestJS guard
│   │   ├── devices.schema.ts                        # MODIFIED — new fields
│   │   ├── devices.controller.ts                    # MODIFIED — new endpoints
│   │   └── dto/
│   │       ├── device-state-transition.dto.ts       # NEW
│   │       └── capability-manifest-update.dto.ts    # NEW
│   │
│   ├── fleet-monitor/
│   │   ├── heartbeat-monitor.service.ts             # MODIFIED — threshold + FSM call
│   │   ├── health-threshold-evaluator.service.ts    # NEW — battery/storage/GPS logic
│   │   └── health-threshold-evaluator.service.spec.ts # NEW — TDD first
│   │
│   ├── configuration-profiles/                      # NEW module
│   │   ├── configuration-profiles.module.ts
│   │   ├── configuration-profiles.controller.ts
│   │   ├── configuration-profiles.service.ts
│   │   ├── configuration-profiles.service.spec.ts
│   │   ├── configuration-profile.schema.ts
│   │   ├── configuration-profiles.repository.ts
│   │   └── dto/
│   │       ├── create-configuration-profile.dto.ts
│   │       └── update-configuration-profile.dto.ts
│   │
│   └── device-groups/                               # NEW module
│       ├── device-groups.module.ts
│       ├── device-groups.controller.ts
│       ├── device-groups.service.ts
│       ├── device-groups.service.spec.ts
│       ├── device-group.schema.ts
│       ├── device-groups.repository.ts
│       └── dto/
│           ├── create-device-group.dto.ts
│           └── group-membership-update.dto.ts
│
└── infrastructure/
    └── mqtt/
        └── mqtt.service.ts                          # MODIFIED — add publishDeviceConfig()

app/openad-management/src/app/
├── device-groups/                                   # NEW Angular feature module
│   ├── device-groups.component.ts                   # Main drag-and-drop UI
│   ├── device-groups.component.html
│   ├── device-groups.component.scss
│   └── device-groups.service.ts                    # HTTP client for groups/profiles API
│
└── shared/
    └── device-lifecycle-state.pipe.ts              # NEW — format state enum for display

app/openad-ad-client/src/
└── app/
    ├── services/
    │   ├── capability-manifest.service.ts          # NEW — collects + submits manifest
    │   ├── storage-manager.service.ts              # NEW — LRU eviction + storage tracking
    │   └── power-state-monitor.service.ts          # NEW — engine-off detection + MQTT publish
    └── capacitor/
        └── power-state.plugin.ts                   # NEW — native Android broadcast receiver bridge
```

**Structure Decision**: Monorepo Option 3 (Mobile + API + Management SPA) — the feature spans all three existing apps. New NestJS modules (`configuration-profiles/`, `device-groups/`) follow the existing module-per-domain pattern in `app/openad-api/src/modules/`. New Angular feature (`device-groups/`) follows the existing page-level directory pattern in `app/openad-management/src/app/`. Tablet services (`app/openad-ad-client/src/app/services/`) follow the existing Capacitor service pattern.

---

## Complexity Tracking

> No constitution violations requiring justification.

---

## Phase 0: Research Summary

All unknowns resolved in [`research.md`](./research.md). Key decisions:

| Topic | Decision |
|-------|----------|
| State machine implementation | Hand-coded transition table in `DeviceStateMachineService` (no FSM library) |
| Heartbeat timeout | Extend existing `@Cron` sweep; threshold 120s → 180s; call FSM instead of `markOffline()` |
| UUID blacklist | Dedicated `retired_device_registry` collection; NestJS guard on all device routes |
| Profile storage | Two new MongoDB collections (`configuration_profiles`, `device_groups`); FK chain via `Device.groupId` |
| Config propagation | MQTT push on `devices/{deviceId}/config` topic; reuses existing `mqtt.service.ts` |
| Capability manifest | `PATCH /devices/{deviceId}/capability-manifest` REST endpoint; replaces/extends `hardwareProfile` |
| Storage eviction | LRU algorithm; local cache index tracks `assetId`, `sizeBytes`, `lastPlayedAt` |
| Engine-off detection | Android `ACTION_POWER_DISCONNECTED` broadcast intent via Capacitor plugin bridge |
| Download resumption | HTTP byte-range (`Range: bytes=N-`); persisted checkpoint in local DB |
| Management UI | Angular CDK Drag & Drop; persist via `PATCH /device-groups/{groupId}/members` |
| Audit log | Append-only `device_lifecycle_events` collection; separate from `devices` document |

---

## Phase 1: Design Artifacts

All Phase 1 artifacts are complete:

- **[data-model.md](./data-model.md)**: Defines 8 entities (3 new collections, 2 modified, 3 sub-documents/enums), state transition matrix, validation rules, and MongoDB index decisions.
- **[contracts/api.md](./contracts/api.md)**: Full REST contracts for 11 new/modified endpoints, MQTT topic schemas (3), and WebSocket push events (2).
- **[quickstart.md](./quickstart.md)**: Developer runbook — how to run, test, debug, and navigate new/modified files. Includes MQTT debug commands and feature flag reference.

---

## Next Step

Run `/speckit.tasks` to generate the implementation task list from this plan.
