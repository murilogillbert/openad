# Implementation Plan: Tablet Ops Pipeline

**Branch**: `003-tablet-ops-pipeline` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Deliver end-to-end **tablet operations** for the OpenAD fleet: hardware-bound secure pairing (replacing manual codes with fingerprint + one-time secret), **MQTT command & control** (screenshot, cache clear, APK upgrade, volume/brightness) with audited lifecycles, **client-side self-healing** (Deep Sleep, Safety Loop, daily player restart), and **delta manifest sync** with **Sync Windows** and resumable downloads. Implementation spans **NestJS** (`openad-api`), **Angular** management UI (`openad-management`), and **Angular + Capacitor** tablet app (`openad-ad-client`), with shared types in **`libs/domain`**, **`libs/api-contracts`**, and **`libs/mqtt-contracts`**.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20 LTS  
**Primary Dependencies**: NestJS 11, Angular 21, Capacitor 8, Mongoose/MongoDB driver, Zod (mqtt-contracts), JWT (`@nestjs/jwt`), MQTT (`mqtt` / `@capgo/capacitor-mqtt`)  
**Storage**: MongoDB (devices, pairing, commands, manifest versions, sync rules, audit logs)  
**Testing**: Jest (API, libs), Angular/Karma or Jest (client per project config), Playwright (e2e where applicable)  
**Target Platform**: NestJS API (Linux/container), Angular web (management), Android tablet (Capacitor ad client)  
**Project Type**: Nx monorepo — API + Angular admin + Capacitor mobile client + shared libraries  
**Performance Goals**: Pairing E2E under 2 minutes (SC-001); screenshot thumbnail under 15 s (SC-003); volume/brightness under 5 s (SC-005); config push under 60 s (SC-010); delta sync at least 83% byte reduction on representative campaign (SC-009)  
**Constraints**: Offline-capable command queue via MQTT persistent session + server-side TTL; secrets not stored plaintext; hardware fingerprint on every authenticated device request; cellular bandwidth minimisation via delta + sync windows  
**Scale/Scope**: Fleet-sized device counts (MongoDB indexes for deviceId, groupId, command expiry); four user stories (P1–P4) with shared infrastructure

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with each principle from `.specify/memory/constitution.md`:

- [x] **I. KISS** — One pairing flow, one command pipeline, one manifest versioning scheme; avoid parallel auth mechanisms beyond device JWT + admin RBAC.
- [x] **II. DRY** — Pairing, command, and manifest types live in `libs/domain` / `libs/api-contracts` / `libs/mqtt-contracts`; MQTT topic names remain centralized (`mqtt-topics.ts`, `MqttService`).
- [x] **III. SOLID** — Domain services own pairing validation, command lifecycle, and manifest diff; tablet services own playback/watchdog/sync orchestration behind narrow interfaces.
- [x] **IV. YAGNI** — Scope matches spec only (e.g. no per-device Sync Window overrides); Emergency Sync as explicit command per FR-028.
- [x] **V. TDA** — `RemoteCommand` / `PairingRequest` carry transition rules or delegate to services; avoid scattered status checks outside state/command services.
- [x] **VI. TDD** — Contract tests for Zod schemas and REST DTOs first; API integration tests for pairing and command lifecycle; tablet unit tests for watchdog and sync schedulers.
- [x] **VII. Enterprise Quality** — Structured logging on pairing failures and hardware mismatch; semantic versioning for public API additions; security checklist for JWT claims and presigned URLs.
- [x] **VIII. Clean Code** — Intention-revealing names (`hardwareFingerprintHash`, `manifestVersionAck`); short command handlers; comments only for non-obvious timing (e.g. 3 AM deferral).

> No constitution violations requiring justification; Complexity Tracking table left empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-tablet-ops-pipeline/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
app/openad-api/src/
├── modules/
│   ├── devices/           # pairing, bind, device JWT guards, fingerprint validation
│   ├── fleet-monitor/     # command dispatch, ack handling (extend)
│   └── …                  # manifest/delta endpoints as added
app/openad-management/src/
└── app/                   # admin UI: pending pairings, command console, sync windows
app/openad-ad-client/src/
├── app/services/          # MQTT, storage, pairing, media sync, watchdog
└── capacitor/             # native bridges (power, volume, brightness)
libs/domain/src/
└── lib/entities.ts        # shared entity types
libs/api-contracts/src/
└── lib/types.ts           # REST DTOs
libs/mqtt-contracts/src/
└── lib/schemas.ts         # Zod schemas for MQTT payloads
```

**Structure Decision**: Use existing Nx apps and shared libs; extend `serverCommandPayloadSchema` and REST contracts rather than new packages. MongoDB collections added or extended per `data-model.md`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phase 0 & 1 Outputs

| Artifact | Path |
|----------|------|
| Research | `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/research.md` |
| Data model | `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/data-model.md` |
| REST contracts | `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/contracts/rest-api.md` |
| MQTT contracts | `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/contracts/mqtt.md` |
| Quickstart | `/home/bode/Documents/repos/openad/openad-monorepo/specs/003-tablet-ops-pipeline/quickstart.md` |

## Constitution Check (post-design)

Re-evaluated after `research.md`, `data-model.md`, and `contracts/` — all eight principles remain satisfied; no new complexity debt.
