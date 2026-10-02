# Feature Specification: MDM APK Distribution & Updates

**Feature Branch**: `009-mdm-apk-distribution`  
**Created**: 2026-04-21  
**Status**: Draft  
**Input**: User description: "okay i see that you modified the app to become a real DPC / Device Admin receiver. But i want to go beyond. I want this app to be sideloaded in our server and avaialable for the instalations through a qrcode of the latest version located on the management panel! This is mandatory. We are building a fully manageg MDM structure within the application repository and infrasctructure to scale this. The workflow will work like this: The app will be built with the correct certificate/keytool (app needs to be updated to accomodate these build targets/signing configs). Then we will generate the current version information on the backend (whatever endpoints/files/resources needed for achieve versioning for auto updates and versioned apk hosting) through a management pannel configuration (complete with apk upload and version number registry and qrcode upload only for the superadmin to access). The android app should auto check for updates on its own on a daily basis. Also there will be a command implemented to trigger the update fectch proccess through the already command layer implemented on the existing mqtt infrastructure"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish an installable release via QR (Priority: P1)

As a Superadmin, I can upload a new signed Android app release, register its version, and obtain a QR code from the management panel that installs the latest approved release on a fresh device.

**Why this priority**: This is the distribution mechanism required to scale installations; without it, field deployment is manual and error-prone.

**Independent Test**: Upload one release, set it as “latest”, scan QR on a test device, and confirm the correct version is installed.

**Acceptance Scenarios**:

1. **Given** a Superadmin is signed in, **When** they upload a release and mark it as the latest approved version, **Then** the management panel shows a QR code that resolves to that exact release.
2. **Given** a QR code for the latest approved release, **When** an installer scans it on a device, **Then** the device downloads the release from the server and installation can proceed successfully.

---

### User Story 2 - Device auto-checks for updates daily (Priority: P2)

As a Fleet operator, devices automatically check for newer approved releases on a daily schedule and can update themselves to keep fleets current without manual visits.

**Why this priority**: Reduces operational cost and ensures security and feature rollout across the fleet.

**Independent Test**: With a device on an older version, publish a newer approved release and verify the device detects it within the daily window and completes the update flow.

**Acceptance Scenarios**:

1. **Given** a device is online and running an older version, **When** the daily update check occurs, **Then** it detects that a newer approved release exists.
2. **Given** a newer approved release exists, **When** the device update process runs, **Then** the device eventually runs the new version and reports the new version as active.

---

### User Story 3 - Remotely trigger an update check (Priority: P3)

As a Fleet operator, I can trigger an “update check now” command for a specific device (or a set of devices) via the existing remote command mechanism, so urgent fixes can roll out immediately.

**Why this priority**: Enables urgent patch rollout without waiting for the daily schedule.

**Independent Test**: Send a remote command to a single device and confirm it checks for updates and starts the update flow.

**Acceptance Scenarios**:

1. **Given** a device is online, **When** the operator issues an update-check command, **Then** the device performs an update check promptly and reports the result.
2. **Given** the device is offline, **When** the operator issues an update-check command, **Then** the command is handled safely (queued or rejected) and the operator can see it didn’t complete.

---

### Edge Cases

- **No network / captive portal**: device cannot reach the release endpoint; it must not brick or loop-restart; it should retry later and surface a reason.
- **Interrupted download**: the update download is interrupted (power loss, network drop); device resumes or restarts safely without corrupting the current install.
- **Invalid or tampered artifact**: the server or device detects an invalid signature/hash; update must be rejected and logged.
- **Version rollback policy**: operator tries to mark an older release as “latest”; system enforces policy (allowed or blocked) consistently.
- **Incompatible device**: device model/OS does not support the new release; system prevents offering it to that device.
- **Permission/role enforcement**: non-superadmin attempts to upload or publish a release; action is denied and audited.

## Clarifications

### Session 2026-04-21

- Q: When a newer approved release exists, should the device update silently or require confirmation? → A: Silent update (no UI prompts).
- Q: Should devices update to any uploaded release, or only approved/published releases? → A: Staged rollout (approved-only with rollout limited by % or device group).
- Q: Should the management-panel QR code always install the staged rollout target or the latest approved stable release? → A: Latest approved stable release (rollouts apply to updates, not initial install).
- Q: What is the intended meaning of the install QR code? → A: It provisions a freshly reset device into managed (Device Owner) mode using Android’s built-in managed provisioning QR flow, then installs/configures the app as the dedicated kiosk app.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a Superadmin to upload an Android app release artifact to the server.
- **FR-002**: System MUST store release metadata including version identifier, upload time, who uploaded it, and an “approved/published” status.
- **FR-003**: System MUST support designating exactly one release as “latest approved” for installation via a management-panel QR code.
- **FR-004**: System MUST provide a QR code that resolves to a server URL for installing/downloading the latest approved release.
- **FR-005**: System MUST provide a device-readable “latest release” manifest that includes at minimum: latest version identifier and a secure download location.
- **FR-006**: The device app MUST be able to determine its currently installed version identifier.
- **FR-007**: The device app MUST check for updates on a daily schedule and compare its installed version to the latest approved version.
- **FR-008**: The device app MUST support receiving a remote command to trigger an immediate update check (using the existing device command channel).
- **FR-009**: If an update is available, the device app MUST download the artifact securely, verify integrity, and install it without user prompts (silent update).
- **FR-010**: The system MUST ensure only authorized roles (Superadmin) can upload/publish releases and access the QR workflow.
- **FR-011**: The system MUST record an audit trail for release upload, publish/unpublish actions, and QR regeneration.
- **FR-012**: The system MUST support hosting multiple versions concurrently (versioned hosting), not just “latest”.
- **FR-013**: The system MUST allow administrators to view which release version each device is currently running.
- **FR-014**: The system MUST support staged rollout of an approved release by limiting eligibility to a defined device set (e.g., by device group and/or rollout percentage).
- **FR-015**: The QR install flow MUST always resolve to the latest approved stable release, independent of any staged rollout settings.
- **FR-016**: The QR install flow MUST support provisioning a freshly reset device into managed (Device Owner) mode as part of installation, using the platform’s standard managed provisioning QR mechanism.
- **FR-017**: The QR install flow MUST result in the device being configured for dedicated/kiosk use such that the installed app can enter lock-task/kiosk mode as intended after provisioning.

### Key Entities *(include if feature involves data)*

- **Release**: A versioned Android application artifact with metadata (version identifier, approval status, publish time, uploader, integrity data).
- **Release Channel**: The “latest approved” pointer used for installs and updates (can be expanded later to multiple channels like beta/stable).
- **Device**: A managed installation that reports its current release version and update status.
- **Install QR Code**: A scannable representation of the latest approved release install URL.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Superadmin can publish a new release and obtain a working install QR code in under 2 minutes (excluding artifact upload time).
- **SC-002**: On a newly provisioned device with network access, scanning the QR code results in installation success on the first attempt at least 95% of the time.
- **SC-003**: Devices perform a daily update check within a 24-hour window at least 99% of the time when they have connectivity during that window.
- **SC-004**: For a remote “check for updates now” command, at least 95% of online devices start the update-check process within 60 seconds.
- **SC-005**: No device enters a boot-loop or becomes unusable due to a failed download, invalid artifact, or interrupted update (safe failure behavior).
- **SC-006**: When an approved update is available and the device is online, the update completes without requiring user interaction at least 95% of the time.
- **SC-007**: When a staged rollout is configured, at least 99% of devices outside the eligible set do not attempt to install that release.

## Assumptions

- Devices have intermittent connectivity; the system must tolerate offline periods and retry later without human intervention.
- The organization controls the signing identity used for release builds; devices must accept only properly signed artifacts.
- A single “latest approved” channel is sufficient for initial rollout; multiple channels (beta/stable) may be added later.
- The existing device communication mechanism can deliver a command to trigger an update check (no new communication channel is required for v1).
