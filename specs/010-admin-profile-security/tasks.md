# Tasks: Admin Console — Profile, Configuration, Releases

**Input**: Design documents in `specs/010-admin-profile-security/`  
**Reference designs (do not implement literally; use PrimeNG + repo patterns)**:
- `designs/management-panel/desktop/openad_settings_my_profile/screen.png`
- `designs/management-panel/desktop/openad_settings_my_profile/code.html`
- `designs/management-panel/mobile/settings_my_profile_mobile/screen.png`
- `designs/management-panel/mobile/settings_my_profile_mobile/code.html`
- `designs/management-panel/desktop/openad_settings_platform_configuration/screen.png`
- `designs/management-panel/desktop/openad_settings_platform_configuration/code.html`
- `designs/management-panel/mobile/platform_configuration_mobile/screen.png`
- `designs/management-panel/mobile/platform_configuration_mobile/code.html`
- `designs/management-panel/desktop/openad_settings_mdm_release_management/screen.png`
- `designs/management-panel/desktop/openad_settings_mdm_release_management/code.html`
- `designs/management-panel/mobile/mdm_release_management_mobile/screen.png`
- `designs/management-panel/mobile/mdm_release_management_mobile/code.html`

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Confirm existing admin routes and navigation patterns in `app/openad-management/src/app/app.routes.ts`
- [x] T002 Confirm existing auth/role guards usage in admin UI and API (identify super-admin gating pattern)
- [x] T003 [P] Create new admin feature folders:
  - `app/openad-management/src/app/profile-security/`
  - `app/openad-management/src/app/platform-config/`
- [x] T004 [P] Add initial route stubs for new screens in `app/openad-management/src/app/app.routes.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Do not start user story work until these are complete.

- [x] T005 Define the API contracts (DTOs/types) for profile, sessions, and platform config in `libs/api-contracts/src/` (new files as needed)
- [x] T006 [P] Add API endpoints skeletons (controllers + DTO validation) for Profile & Security:
  - `app/openad-api/src/modules/auth/admin-profile.controller.ts` (profile read/update, change password)
  - `app/openad-api/src/modules/auth/admin-sessions.controller.ts` (list sessions, revoke other sessions)
  - Register controllers in `app/openad-api/src/modules/auth/auth.module.ts`
- [x] T007 [P] Add API session persistence skeleton (to support “Active Sessions”) in:
  - `app/openad-api/src/modules/auth/schemas/admin-session.schema.ts`
  - `app/openad-api/src/modules/auth/admin-sessions.service.ts`
  - `app/openad-api/src/modules/auth/admin-sessions.repository.ts`
- [x] T008 [P] Add platform configuration API skeleton as a dedicated module:
  - `app/openad-api/src/modules/platform-config/platform-config.module.ts`
  - `app/openad-api/src/modules/platform-config/platform-config.controller.ts`
  - `app/openad-api/src/modules/platform-config/platform-config.service.ts`
  - `app/openad-api/src/modules/platform-config/schemas/platform-config.schema.ts`
  - Register module in `app/openad-api/src/app/app.module.ts`
- [x] T009 Add audit logging hooks for security-sensitive and configuration actions (new events + metadata)
- [x] T010 Enforce super-admin-only authorization for Force Update Check endpoint:
  - Update `app/openad-api/src/modules/releases/releases-command.controller.ts` to restrict the route to `super_admin` only
  - Add/adjust corresponding admin UI visibility using `app/openad-management/src/app/auth/portal-auth.service.ts`
- [x] T011 Create/extend shared admin HTTP services for new endpoints in:
  - `app/openad-management/src/app/profile-security/` services
  - `app/openad-management/src/app/platform-config/` services

### Tests (TDD gate for Phase 2)

- [x] T012 [P] Add failing API tests FIRST for profile endpoints in `app/openad-api/src/test/` (or existing test locations)
- [x] T013 [P] Add failing API tests FIRST for session listing + revoke-other-sessions in `app/openad-api/src/test/`
- [x] T014 [P] Add failing API tests FIRST for platform configuration get/save/restore in `app/openad-api/src/test/`

---

## Phase 3: User Story 1 — Master “Latest Stable” QR onboarding (Priority: P1) 🎯 MVP

**Goal**: A master QR code always points to the current “Latest Stable” release; empty state is clear.

**Independent Test**: With a stable release published, the QR payload references the stable download location; without one, UI shows guidance and no misleading QR.

- [x] T015 [P] [US1] Confirm/extend public stable manifest endpoint behaviour in API (empty state message, caching/throttling) under `app/openad-api/src/modules/releases/`
- [x] T016 [P] [US1] Add/extend admin UI “Hero QR area” component using PrimeNG in `app/openad-management/src/app/releases/` (reuse existing releases pages where possible)
- [x] T017 [P] [US1] Add QR payload builder + QR rendering service reuse/extension in `app/openad-management/src/app/releases/provisioning-qr.service.ts`
- [x] T018 [US1] Implement empty-state UX + refresh behaviour for QR area in `app/openad-management/src/app/releases/` page(s)

### Tests (US1)

- [x] T019 [P] [US1] API test: stable manifest returns “no stable release” message when none exists
- [x] T020 [P] [US1] API test: stable manifest returns downloadUrl when stable exists

---

## Phase 4: User Story 2 — Release upload + draft/staged/stable + ledger (Priority: P2)

**Goal**: Admin can upload a release with release notes, choose draft/staged/stable, and see ledger with statuses + reach.

**Independent Test**: Upload → appears in ledger; publish stable updates QR; staged rollout targets only eligible devices.

- [x] T021 [P] [US2] Extend API release upload to persist release notes and uploader identity (ensure notes not exposed publicly) in `app/openad-api/src/modules/releases/`
- [x] T022 [P] [US2] Extend release listing endpoint to include uploader + reach metrics needed by ledger in `app/openad-api/src/modules/releases/`
- [x] T023 [P] [US2] Implement/extend UI “Release Ledger” table with PrimeNG DataTable in `app/openad-management/src/app/releases/`
- [x] T024 [P] [US2] Implement “Upload New Release” side-panel UX (drag/drop + notes + next action) in `app/openad-management/src/app/releases/`
- [x] T025 [P] [US2] Implement staged rollout creation controls (percentage + device group selection) in `app/openad-management/src/app/releases/`
- [x] T026 [P] [US2] Ensure release notes visibility is limited to admins + read-only field tech roles (no public exposure) across API + UI
- [x] T027 [US2] Wire publish-stable action to update ledger status + refresh master QR in UI

### Tests (US2)

- [x] T028 [P] [US2] API test: release notes saved and returned only on privileged endpoints (not public manifest)
- [x] T029 [P] [US2] API test: rollout targeting respects group/percentage rules for eligibility

---

## Phase 5: User Story 3 — Profile & Security (Priority: P3)

**Goal**: Dedicated screen for profile form, change password, active sessions list, and revoke-other-sessions.

**Independent Test**: Update profile; change password; list sessions; revoke all other sessions while current remains.

- [x] T030 [P] [US3] Add Profile & Security route + page shell in `app/openad-management/src/app/profile-security/`
- [x] T031 [P] [US3] Implement profile form (photo upload, name, contact) using PrimeNG in `app/openad-management/src/app/profile-security/`
- [x] T032 [P] [US3] Implement change password section UX (policy feedback + success/failure) in `app/openad-management/src/app/profile-security/`
- [x] T033 [P] [US3] Implement active sessions list UI (label, last active, “Active now”) in `app/openad-management/src/app/profile-security/`
- [x] T034 [US3] Implement “Log Out of All Other Devices” action with confirmation + toast feedback in `app/openad-management/src/app/profile-security/`
- [x] T035 [P] [US3] Implement/extend API endpoints for profile read/update + photo handling in `app/openad-api/src/modules/auth/admin-profile.controller.ts`
- [x] T036 [P] [US3] Implement/extend API endpoint for password change + audit in `app/openad-api/src/modules/auth/admin-profile.controller.ts`
- [x] T037 [P] [US3] Implement/extend API endpoints for sessions list + revoke-other-sessions + audit in `app/openad-api/src/modules/auth/admin-sessions.controller.ts`
- [x] T038 [P] [US3] Add UI tests FIRST for critical Profile & Security flows:
  - `app/openad-management/src/app/profile-security/*.spec.ts` (new)

### Tests (US3)

- [x] T039 [P] [US3] API test: revoke-other-sessions leaves current session valid and revokes others
- [x] T040 [P] [US3] API test: sessions list returns minimum fields only (label, lastActiveAt, isCurrent)

---

## Phase 6: User Story 4 — Platform Configuration Console (Priority: P4)

**Goal**: Card-based settings console with explicit Save banner, discard, restore defaults, and fleet-wide application.

**Independent Test**: Change values → banner appears; nothing applies until save; restore defaults resets pending; save persists.

- [x] T041 [P] [US4] Add Platform Configuration route + page shell in `app/openad-management/src/app/platform-config/`
- [x] T042 [P] [US4] Implement card layout (Media Limits / Fleet Health / Analytics) using PrimeNG in `app/openad-management/src/app/platform-config/`
- [x] T043 [P] [US4] Implement “Save Changes” floating banner pattern + unsaved-changes navigation guard in `app/openad-management/src/app/platform-config/`
- [x] T044 [P] [US4] Implement “Restore Default Settings” confirmation flow in `app/openad-management/src/app/platform-config/`
- [x] T045 [P] [US4] Implement platform config API endpoints (get/save/restore) + audit logging in `app/openad-api/src/modules/platform-config/platform-config.controller.ts`
- [x] T046 [US4] Ensure platform config applies fleet-wide only (no group/device overrides) in API and UI copy
- [x] T047 [P] [US4] Add UI tests FIRST for “Save Changes banner” and “Restore defaults” behaviours in `app/openad-management/src/app/platform-config/*.spec.ts` (new)

### Tests (US4)

- [x] T048 [P] [US4] API test: save requires explicit call; get returns active values; restore resets to defaults
- [x] T049 [P] [US4] API test: audit entry created on save and on restore defaults

---

## Phase 7: Cross-cutting — PDF cheat-sheet + Force Update Check

- [x] T050 [P] Implement “Download PDF” generation for QR + 3-step instructions in `app/openad-management/src/app/releases/` (ensure no secrets)
- [x] T051 [P] Add/extend API endpoint(s) or client-side generation approach as per repo patterns; document behaviour in `specs/010-admin-profile-security/contracts/device-releases-dashboard.md`
- [x] T052 [P] Implement per-device “Force Update Check” button in the device workspace overview UI:
  - `app/openad-management/src/app/devices/device-overview.page.ts`
  - `app/openad-management/src/app/devices/device-overview.page.html`
  - Use existing releases API client `app/openad-management/src/app/releases/releases-api.service.ts#triggerUpdateCheck`
- [x] T053 Enforce super-admin-only visibility in UI and permission in API:
  - UI: gate the button using `app/openad-management/src/app/auth/portal-auth.service.ts` (role === super_admin)
  - API: restrict `app/openad-api/src/modules/releases/releases-command.controller.ts` route to `super_admin`
- [x] T054 [P] Add audit event for Force Update Check action and verify metadata includes actor + deviceId

---

## Phase 8: Polish & Validation

- [x] T055 [P] Add consistent PrimeNG styling + responsive layout checks (desktop + mobile) across all three areas
- [x] T056 [P] Add empty/loading/error states for all new API-backed views (toasts + inline states)
- [x] T057 Run the feature quickstart and confirm each acceptance scenario is satisfied using `specs/010-admin-profile-security/quickstart.md`

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1 (MVP) can ship independently.
- US2 builds on Releases UI patterns but can proceed after Phase 2.
- US3 and US4 can proceed after Phase 2 in parallel with US2 (different areas/files).
- Phase 7 depends on Releases UI work (US1/US2) and monitoring area access patterns.

## Parallel opportunities

- Any task marked **[P]** can be executed in parallel (different files, minimal dependencies).
