# Implementation Plan: MDM APK Distribution & Updates

**Branch**: `009-mdm-apk-distribution` | **Date**: 2026-04-21 | **Spec**: `specs/009-mdm-apk-distribution/spec.md`  
**Input**: Feature specification from `specs/009-mdm-apk-distribution/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Provide a first-party MDM-style distribution workflow for the Android ad-client:

- Superadmin can upload signed APK releases in the management panel, publish “latest approved stable”, and obtain a QR code for **Android managed provisioning** (Device Owner) on freshly reset devices.
- Devices silently update via daily checks and via an operator-triggered remote command, with staged rollout controls (group/percentage).
- Backend hosts versioned APKs + a device-readable “latest release” manifest, and records audit + per-device installed version status.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (Angular 21) + Node.js (NestJS 11) + Java (Android host)  
**Primary Dependencies**: Nx monorepo, Angular 21 (tablet client), NestJS 11 (API), Capacitor 8 (Android app), MQTT command channel  
**Storage**: MongoDB (existing API), S3-compatible object storage (existing API) + local filesystem for APK artifacts  
**Testing**: Jest/Vitest (TS), Playwright (e2e where applicable), Android smoke tests via adb/manual validation  
**Target Platform**: Linux servers (API + management panel), Android tablets (Device Owner / dedicated device)  
**Project Type**: Mobile (Android) + Web admin panel + Web service  
**Performance Goals**: QR install manifest loads quickly; update checks complete within minutes; update command triggers within 60s for online devices  
**Constraints**: Offline-capable devices; silent updates; staged rollout safety; security posture requires artifact integrity verification and strict admin authorization  
**Scale/Scope**: Fleet deployments (10s–1000s of devices), multiple release versions hosted concurrently

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with each principle from `.specify/memory/constitution.md`:

- [ ] **I. KISS** — Is the design the simplest correct solution? Is complexity justified?
- [ ] **II. DRY** — Does any logic duplicate existing code? Is there a single authoritative representation?
- [ ] **III. SOLID** — Are SRP, OCP, LSP, ISP, DIP respected in the proposed design?
- [ ] **IV. YAGNI** — Is every proposed element traceable to a current requirement?
- [ ] **V. TDA** — Does behaviour live with the data? Are there anemic models or feature envy?
- [ ] **VI. TDD** — Are tests planned to be written *before* implementation? Is Red-Green-Refactor enforced?
- [ ] **VII. Enterprise Quality** — Are logging, error handling, versioning, security, and docs addressed?
- [ ] **VIII. Clean Code** — Are names intention-revealing? Functions single-purpose? Comments explaining *why*?

> Fill the Complexity Tracking table below for any violations that are unavoidable.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
app/openad-api/                          # backend API (release hosting, manifests, authz)
app/openad-management/                   # management panel (superadmin UI)
app/openad-ad-client/                    # Android Capacitor app (update client)
  android/                               # native Android host
libs/api-contracts/                      # shared contracts used by client + API
libs/mqtt-contracts/                     # MQTT command/message contracts
tools/                                  # build tooling (e.g., index copy, apk helpers)
```

**Structure Decision**: Use existing Nx apps/libraries; add a “releases” feature slice in `openad-api` and an admin panel section in `openad-management`. Keep device update logic inside `openad-ad-client` plus shared contracts in `libs/*`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

## Phase 0: Research & Decisions (completed)

Artifacts:

- `specs/009-mdm-apk-distribution/research.md`

Key decisions captured:

- Device Owner provisioning via Android managed provisioning QR flow (freshly reset devices)
- Silent updates + staged rollout controls
- Install QR targets “latest approved stable”

## Phase 1: Design (completed)

Artifacts:

- Data model: `specs/009-mdm-apk-distribution/data-model.md`
- Contracts:
  - `specs/009-mdm-apk-distribution/contracts/release-manifest.md`
  - `specs/009-mdm-apk-distribution/contracts/mqtt-update-command.md`
- Quickstart: `specs/009-mdm-apk-distribution/quickstart.md`

Design notes (high level):

- **Release hosting**: store versioned APK artifacts + integrity metadata; expose stable download URLs and a device-readable manifest.
- **Install QR**: management panel generates a provisioning QR payload that points to the latest approved stable release and provisions Device Owner.
- **Update checks**: device performs daily silent checks; operator can trigger an immediate check via command channel.
- **Staged rollout**: backend decides eligibility for a device (group and/or percentage); devices outside the eligible set must not attempt installation.
- **Auditability**: release upload/publish/rollout changes are recorded as audit events; management UI can view per-device installed version.

## Phase 2: Implementation Plan (to be executed)

### Backend (release hosting + manifests)

- Implement release artifact upload + storage + integrity calculation
- Implement latest-stable manifest endpoint
- Implement per-device update eligibility manifest endpoint (rollout logic)
- Implement audit trail for release and rollout actions
- Implement device version reporting endpoint + UI surfacing

### Management panel (Superadmin release workflow)

- Superadmin-only release upload UI
- Publish “latest approved stable”
- Rollout configuration UI (groups/percentage)
- Provisioning QR generation UI for Device Owner enrollment

### Android app (device update client)

- Daily update check job (silent)
- On-command “update check now” handler
- Download + verify + silent install update flow
- Post-update “re-assert kiosk” behavior after package replaced

### Testing & validation

- Unit tests for rollout eligibility and manifest responses
- Integration tests for artifact upload + manifest reads
- Manual/automated Android smoke validation using `quickstart.md`

