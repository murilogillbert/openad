# Implementation Plan: Admin Console — Profile, Configuration, Releases

**Branch**: `010-admin-profile-security` | **Date**: 2026-04-22 | **Spec**: `./spec.md`
**Input**: Feature specification from `specs/010-admin-profile-security/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Deliver three administrator-facing console areas:

- Profile & Security (profile form, change password, active sessions, revoke other sessions).
- Platform Configuration Console (card-based settings with explicit save banner + restore defaults).
- Device App Releases dashboard (master “Latest Stable” provisioning QR, release ledger, upload + rollout workflows, PDF export, and per-device force update check restricted to super-admin).

Implementation integrates existing admin UI, existing auth/roles, and the existing releases subsystem pattern already present in the codebase, adding new UI routes/components and backend endpoints only where requirements demand.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (Nx monorepo)  
**Primary Dependencies**: Angular (admin UI), NestJS (API), MongoDB/Mongoose, PrimeNG (UI components)  
**Storage**: MongoDB for domain entities; object storage used for APK artifacts (existing infrastructure)  
**Testing**: Jest (unit/integration), existing API test harnesses; e2e as available  
**Target Platform**: Web admin console + API service; managed Android devices consume release flows  
**Project Type**: Web application + backend API (monorepo)  
**Performance Goals**: Admin actions feel instantaneous; settings save and list views respond in < 1s on typical networks; release list and sessions list support at least 100 entries without UI degradation  
**Constraints**: Security-first for account/session actions; explicit save flow for configuration; least privilege for Force Update Check (super-admin only)  
**Scale/Scope**: Single admin console with 3 new areas; supports small-to-medium fleets (hundreds to thousands of devices)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with each principle from `.specify/memory/constitution.md`:

- [x] **I. KISS** — Prefer extending existing admin/API patterns over new frameworks or generalized “settings engines”.
- [x] **II. DRY** — Single source of truth for config schema; reuse existing auth/session primitives and release domain logic.
- [x] **III. SOLID** — Separate UI concerns (pages/services) from API concerns (controllers/services); keep config validation centralized.
- [x] **IV. YAGNI** — No per-device/group config overrides in v1; no public release notes.
- [x] **V. TDA** — Put decision logic (eligibility, status transitions) in domain services, not UI.
- [x] **VI. TDD** — Add failing tests for each new API endpoint and critical UI behaviours before implementation.
- [x] **VII. Enterprise Quality** — Audit logs for security + release actions; robust error handling and permission gates; API documentation updated.
- [x] **VIII. Clean Code** — Consistent naming (Profile & Security, Configuration Console, Releases); small components/services.

> Fill the Complexity Tracking table below for any violations that are unavoidable.

No unavoidable violations identified in the current plan; complexity stays within existing module boundaries.

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
```text
app/openad-management/src/app/
├── app.routes.ts
├── releases/                  # existing release area (extend)
├── profile-security/          # new (profile + password + sessions)
└── platform-config/           # new (card-based config console)

app/openad-api/src/app/
├── app.module.ts
├── env.validation.ts
└── (auth/session modules)     # existing (extend)

app/openad-api/src/modules/
├── releases/                  # existing release domain (extend if needed)
├── admin/ or users/           # existing (extend for profile/sessions)
└── configuration-profiles/    # existing concept (extend or add new config module)
```

**Structure Decision**: Extend the existing admin UI under `app/openad-management/src/app/` with two new feature folders and reuse/extend the existing `releases/` area. Extend the API under `app/openad-api` by adding endpoints and services within existing modules where the responsibility naturally fits (auth/sessions; configuration; releases).

## Phase 0: Research

Output: `research.md` with concrete decisions (no NEEDS CLARIFICATION remaining).

Research topics for this feature:

- Session model: confirm how admin sessions are represented and revoked today, and what additional data is available for display (device label, last seen).
- Configuration source of truth: confirm where fleet-wide operational thresholds live today and how they are validated/audited.
- PDF generation approach: confirm existing PDF/print tooling patterns in the admin UI (if any) and select the simplest consistent approach.

## Phase 1: Design & Contracts

Output: `data-model.md`, `contracts/*`, `quickstart.md`.

Design deliverables:

- Data model additions/changes for:
  - Admin profile (photo + contact fields)
  - Admin sessions (revocable sessions list)
  - Platform configuration (draft/pending vs active; audit trail)
  - Release ledger reach metrics (installed count inputs)
- Contracts for:
  - Admin profile CRUD
  - Password change
  - Sessions listing + revoke-other-sessions
  - Platform configuration get/preview/save/restore-defaults
  - Releases dashboard: stable QR manifest endpoint, PDF payload contract, and force-update-check action (super-admin only)

## Phase 2: Implementation Plan (high level)

- Build UI screens (routes + page components) for Profile/Security and Platform Configuration.
- Extend Releases dashboard for the master QR zone, PDF export, release ledger enhancements, and upload/rollout panel.
- Implement/extend API endpoints with strict authorization, auditing, and tests.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
