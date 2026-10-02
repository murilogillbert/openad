# Feature Specification: Admin Console — Profile, Configuration, Releases

**Feature Branch**: `010-admin-profile-security`  
**Created**: 2026-04-22  
**Status**: Draft  
**Input**: User description: "User Profile & Security Area; Platform Configuration Console; Device App Releases (MDM Dashboard) + Force Update Check"

## User Scenarios & Testing *(mandatory)*

These user stories are ordered to deliver operational value quickly while keeping security-sensitive actions explicit and auditable.

### User Story 1 - Onboard a new tablet with “Latest Stable” QR (Priority: P1)

As an administrator or field technician, I need a single, always-correct QR code that installs and locks down a brand new tablet with the latest approved software, so onboarding is fast and consistent.

**Why this priority**: This is the highest leverage operational workflow: it reduces setup time, prevents drift, and ensures new devices start on an approved build.

**Independent Test**: Can be tested by publishing a “Latest Stable” release and verifying the QR code payload points to that stable release without needing any other new console features.

**Acceptance Scenarios**:

1. **Given** there is no stable release published, **When** an admin opens the Releases dashboard, **Then** the QR area clearly indicates there is no “Latest Stable” and provides a next step (publish a release) without displaying a misleading QR code.
2. **Given** a release is marked “Latest Stable”, **When** an admin views the master QR code, **Then** scanning the QR yields a provisioning payload that references the stable release’s download location.
3. **Given** a newer release is later made “Latest Stable”, **When** an admin refreshes the dashboard, **Then** the displayed master QR code updates to the new stable release.

---

### User Story 2 - Roll out a new app release safely (Priority: P2)

As an administrator, I want to upload a new app release, choose whether it stays a draft, is staged to a subset of the fleet, or becomes the “Latest Stable”, so I can manage risk and control rollout impact.

**Why this priority**: Controlled updates reduce outages and enable testing with real devices before broad deployment.

**Independent Test**: Can be tested by uploading a release, observing it in the ledger with correct status badges, initiating a staged rollout, and confirming that only eligible devices see an update available.

**Acceptance Scenarios**:

1. **Given** an admin has a new release file and version details, **When** they upload the release, **Then** the release appears in the ledger as “Draft/Uploaded” with uploader identity and timestamp.
2. **Given** a release is in Draft state, **When** the admin selects “Make Latest Stable”, **Then** the release becomes “Latest Stable” and the master QR code updates.
3. **Given** a release is uploaded, **When** the admin selects “Staged Rollout” and chooses a target group and/or percentage, **Then** the rollout is created and shown as “Staged” with its scope and status.
4. **Given** a device is not in the targeted group (or is outside the targeted percentage), **When** it checks for updates, **Then** it receives “no update target” and is not instructed to download the new release.

---

### User Story 3 - Administrator secures their own account (Priority: P3)

As an administrator, I need a dedicated profile and security screen to keep my personal details current, change my password, and rapidly revoke other sessions if my device is lost.

**Why this priority**: Reduces account compromise risk and increases administrator confidence; supports rapid incident response.

**Independent Test**: Can be tested by updating profile details, changing password, verifying sessions are listed, and revoking all other sessions while keeping the current session active.

**Acceptance Scenarios**:

1. **Given** the admin is logged in, **When** they open the Profile & Security area, **Then** they see their current profile details, a photo area, and security tools in a single dedicated screen.
2. **Given** the admin enters a new password that meets requirements, **When** they confirm the change, **Then** the password updates and the admin is prompted to re-authenticate if required by policy.
3. **Given** the admin has multiple active sessions, **When** they click “Log Out of All Other Devices”, **Then** all sessions except the current one are revoked and the list updates to reflect the change.

---

### User Story 4 - Configure fleet-wide business rules safely (Priority: P4)

As an administrator, I want to adjust fleet-wide limits (media constraints, health thresholds, analytics thresholds) through a clear control board that requires explicit saving and supports restoring defaults, so changes are deliberate and reversible.

**Why this priority**: Centralizing settings reduces configuration drift and removes the need to edit technical files for day-to-day operational tuning.

**Independent Test**: Can be tested by changing multiple settings, confirming no changes apply until “Save Changes”, and verifying “Restore Default Settings” reverts the pending edits.

**Acceptance Scenarios**:

1. **Given** the admin changes a slider or number field, **When** they make the first change, **Then** a highly visible “Save Changes” banner appears and clearly indicates there are unsaved changes.
2. **Given** there are unsaved changes, **When** the admin navigates away or attempts to close the page, **Then** they are warned about unsaved changes and can choose to keep editing or discard.
3. **Given** the admin clicks “Restore Default Settings”, **When** they confirm the action, **Then** the pending settings reset to factory defaults and the “Save Changes” banner reflects the new pending state.
4. **Given** the admin clicks “Save Changes”, **When** the save completes, **Then** the banner disappears and the updated settings become the new active configuration.

### Edge Cases

- **Conflicting edits**: Two administrators edit configuration around the same time; later save attempts must clearly indicate whether the admin is overwriting newer changes.
- **Session listing privacy**: Session list must not expose sensitive personal data beyond what is needed to identify sessions (e.g., avoid showing full IP address if policy disallows it).
- **Partial connectivity**: If the admin loses connectivity while editing configuration, the UI must preserve unsaved changes locally until the admin chooses to discard or retry saving.
- **Release upload mistakes**: If an admin uploads the wrong release file or incorrect version label, the release must be markable as “Archived/Retired” so it cannot be rolled out or treated as stable.
- **Staged rollout safety**: If a rollout is paused or cancelled, devices should stop being newly targeted by that rollout.
- **Force update check misuse**: Force-update action must be protected to prevent accidental mass use (e.g., must be per-device, not global).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated “Profile & Security” screen for administrators.
- **FR-002**: System MUST allow an administrator to update their profile details including display name and contact details.
- **FR-003**: System MUST allow an administrator to upload, replace, and remove a profile photo.
- **FR-004**: System MUST provide a “Change Password” section and enforce password policy requirements.
- **FR-005**: System MUST display a clear list of the administrator’s active sessions, including device/app identifier and last activity time, and which session is “Active Now”.
- **FR-005a**: Each session entry MUST show (at minimum) a device/browser label, last active time, and an “Active now” marker; it MUST NOT require displaying full IP addresses.
- **FR-006**: System MUST provide a one-click “Log Out of All Other Devices” action that revokes all sessions except the current one.
- **FR-007**: System MUST log security-sensitive actions (password change, session revocation) for audit purposes.

- **FR-008**: System MUST provide a “Platform Configuration Console” screen organized as a vertically scrolling dashboard of categorized cards.
- **FR-009**: System MUST include configuration cards for media limits, fleet health thresholds, and analytics validity thresholds.
- **FR-010**: System MUST NOT apply configuration changes immediately as the admin edits; changes MUST remain pending until the admin confirms “Save Changes”.
- **FR-011**: System MUST display a highly visible “Save Changes” banner when pending changes exist, and MUST allow saving or discarding pending changes.
- **FR-012**: System MUST provide a “Restore Default Settings” action to revert configuration to factory defaults (with an explicit confirmation step).
- **FR-013**: System MUST record an audit entry when platform configuration changes are saved or restored to defaults.
- **FR-013a**: Platform configuration changes MUST apply fleet-wide (all devices) in v1; scoped overrides (by group or by device) are out of scope.

- **FR-014**: System MUST provide a “Device App Releases” dashboard that shows a master QR code for the “Latest Stable” release.
- **FR-015**: System MUST provide a “Download PDF” action that generates a printable sheet containing the master QR code and basic setup instructions.
- **FR-015a**: The PDF cheat-sheet MUST include only the master QR code and a concise 3-step setup instruction block (no secrets).
- **FR-016**: System MUST show a release ledger with version, uploader, date, and fleet reach indicators (e.g., installed device count).
- **FR-017**: System MUST assign clear release status badges: Draft, Staged, Latest Stable, and Archived.
- **FR-018**: System MUST provide an “Upload New Release” workflow including release file upload and release notes entry.
- **FR-018a**: Release notes MUST be visible to administrators and to read-only field technicians (if such a role exists), but MUST NOT be publicly accessible via the master QR flow.
- **FR-019**: System MUST allow an admin to choose post-upload behavior: keep as Draft, start a Staged Rollout, or make Latest Stable.
- **FR-020**: System MUST support staged rollouts targeting a named device group and/or a percentage of the fleet.
- **FR-021**: System MUST provide an “Emergency Override” per-device action (“Force Update Check”) in the vehicle monitoring context that triggers an immediate update check for that device.
- **FR-021a**: Only super-admin (highest privilege) users MUST be able to perform “Force Update Check”.
- **FR-022**: System MUST audit release lifecycle actions (upload, publish stable, start/pause/cancel rollout, QR regeneration, and force update checks).

### Key Entities *(include if feature involves data)*

- **Administrator Profile**: Represents the administrator’s personal details (name, contact details, photo reference).
- **Administrator Session**: Represents a login session with identifying label (device/browser), last seen time, and current-session indicator; revocable.
- **Platform Configuration**: Represents the current active set of fleet-wide business rules; supports draft/pending edits and a default baseline.
- **App Release**: Represents a software release artifact and metadata (version identifier, uploader, timestamp, notes, status).
- **Rollout**: Represents staged deployment rules (target group(s) and/or percentage, status, start/end times).
- **Device Update State**: Represents per-device last update check time/result and installed version (for reach metrics and troubleshooting).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A field technician can onboard a brand new tablet by scanning the master QR code in under 3 minutes (excluding any OS-level setup outside the product).
- **SC-002**: An administrator can upload a new release and publish it as “Latest Stable” in under 2 minutes (excluding upload time dependent on network).
- **SC-003**: Staged rollouts can be configured such that no more than the selected percentage (or out-of-scope devices) are newly targeted for update at any given time.
- **SC-004**: 90% of administrators successfully complete “Log Out of All Other Devices” on the first attempt without assistance.
- **SC-005**: Configuration changes are never applied without an explicit “Save Changes” confirmation (0 unintended immediate applies in acceptance testing).

## Assumptions

- Administrators are authenticated before accessing these screens and have sufficient permissions to manage releases and platform settings.
- “Active sessions” are defined as currently valid login sessions for the same administrator account, and revocation takes effect immediately for future requests.
- The “Platform Configuration Console” targets fleet-wide defaults; per-device overrides (if any) are out of scope for v1 of this feature.
- The “Release Ledger” reach metric can be computed from devices reporting installed versions and update check state.
- The PDF “cheat-sheet” is intended for printing/sharing and contains no secrets (only the QR payload and instructions).

## Clarifications

### Session 2026-04-22

- Q: Who is allowed to use the per-device “Force Update Check” emergency override? → A: Only super-admin / highest-privilege admins.
- Q: Do platform configuration changes apply fleet-wide to all devices, or can they be scoped? → A: Fleet-wide only (v1).
- Q: Who should be able to see the “Release Notes” entered during upload? → A: Admins + field technicians (read-only).
- Q: What minimum information must be shown for each “Active Session” entry? → A: Device/browser label + last active time + “Active now” marker.
- Q: What should the “Download PDF” cheat-sheet include besides the QR code? → A: QR only + concise 3-step setup instructions.
