# Feature Specification: Device State Machine and Configuration Profiles

**Feature Branch**: `002-device-state-machine`  
**Created**: 2026-04-05  
**Status**: Draft  
**Input**: User description: "We are going to build the Device State Machine and Configuration Profiles. This ensures that the API doesn't just 'see' a device, but manages its entire life."

---

## Overview

This feature transforms the platform from a passive device registry into an active fleet management system. It introduces a formal device lifecycle state machine, configuration profiles for grouped rule management, and self-aware tablet intelligence — ensuring every device is fully provisioned, monitored, and controllable from the moment it is onboarded until it is retired.

The system spans three layers: the **API** (state machine logic and automatic state transitions), the **Management App** (configuration profiles and device group management), and the **Tablet App** (capability reporting, intelligent sync, and power-aware playback).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Device Lifecycle State Management (Priority: P1)

As a fleet administrator, I need each tablet device to have a clearly defined operational state so that the system can make automatic decisions about what content the device is allowed to play, and so I can act on health warnings without manually inspecting individual devices.

**Why this priority**: Without a reliable state machine, the platform cannot enforce content restrictions, cannot notify administrators of degraded devices, and cannot prevent rogue or suspended devices from downloading commercial media. This is foundational to all other features in this release.

**Independent Test**: Can be fully tested by provisioning a new device, observing its state progress from `Pending` → `Active`, then simulating a missed heartbeat window and verifying the state transitions to `Flagged` — delivering a fully observable device lifecycle in isolation.

**Acceptance Scenarios**:

1. **Given** a new device record is created in the system, **When** the device has not yet completed pairing, **Then** its state is `Pending` and it is not permitted to download or play commercial media.
2. **Given** a device is in `Pending` state, **When** it successfully completes the pairing handshake and sends its first heartbeat, **Then** its state transitions to `Active` and commercial media access is granted.
3. **Given** a device is in `Active` state, **When** no heartbeat is received for 3 consecutive minutes, **Then** the state automatically transitions to `Flagged` and a notification event is emitted to the Management App.
4. **Given** a device is in `Active` state, **When** any health metric exceeds a critical threshold (battery < 10%, storage > 95%, GPS precision below acceptable range), **Then** the state transitions to `Flagged` and the triggering metric is recorded.
5. **Given** a device is in any non-`Retired` state, **When** an administrator applies a `Suspended` state, **Then** the device immediately stops playing ads and is blocked from downloading new commercial media.
6. **Given** a device is `Suspended`, **When** an administrator restores it to `Active`, **Then** normal operations resume within one heartbeat cycle.
7. **Given** a device is `Retired`, **When** any request arrives using its UUID, **Then** the system rejects the request and the UUID is treated as permanently blacklisted.

---

### User Story 2 - Configuration Profile Management (Priority: P2)

As a fleet administrator, I need to define reusable configuration profiles and assign them to groups of devices so that I can enforce consistent exhibition rules, connectivity policies, and commercial tiers across an entire fleet segment without configuring each tablet individually.

**Why this priority**: Without profiles, every business rule (ad ratios, bandwidth policies, CPM multipliers) must be set per device — an operationally impossible task at scale. Profiles unlock the dense business logic the platform needs to serve differentiated fleet segments.

**Independent Test**: Can be fully tested by creating a profile with a custom ad-to-content ratio and connectivity mode, assigning it to a device group, and verifying that all devices in the group reflect the new rules — delivering value even before the device lifecycle state machine is fully integrated.

**Acceptance Scenarios**:

1. **Given** an administrator creates a Configuration Profile, **When** they define exhibition rules (max loop length, ad-to-content ratio), **Then** the profile is saved and assignable to device groups.
2. **Given** a profile exists, **When** an administrator sets connectivity mode to `Economy`, **Then** managed devices only download media when connected to Wi-Fi.
3. **Given** a profile exists, **When** an administrator sets connectivity mode to `Premium`, **Then** managed devices may download media over any available connection (including 5G/cellular).
4. **Given** a profile exists, **When** an administrator assigns a Commercial Tier with a cost multiplier (e.g., 2.0x for "VIP Black Car"), **Then** all ad impressions on devices in that group are billed at the specified multiplier.
5. **Given** a Device Group exists (e.g., "Airport Fleet"), **When** an administrator drags-and-drops a tablet into that group, **Then** the device immediately inherits the group's assigned profile.
6. **Given** a Profile is updated, **When** the change is saved, **Then** all devices currently assigned to that profile reflect the updated rules within one sync cycle.

---

### User Story 3 - Tablet Capability Reporting & Intelligent Sync (Priority: P3)

As a tablet device in the field, I need to report my hardware capabilities at pairing time and self-manage my local storage intelligently so that the platform assigns me appropriate content and I never enter a broken state due to storage overflow or missed downloads.

**Why this priority**: Without self-awareness, tablets either receive content they cannot render (wrong resolution) or fill their storage and fail silently. This story eliminates those failure modes, making the fleet self-healing.

**Independent Test**: Can be fully tested by triggering a sync cycle on a low-storage tablet and verifying that the oldest cached content is evicted before a new download begins — demonstrating intelligent storage management without requiring full state machine integration.

**Acceptance Scenarios**:

1. **Given** a tablet completes the pairing handshake, **When** it sends its capability manifest, **Then** the system records screen resolution, total storage, available storage, OS version, and app version.
2. **Given** the platform has a new media asset to deliver, **When** the tablet's available storage is insufficient, **Then** the tablet automatically evicts the oldest cached asset before beginning the download.
3. **Given** a tablet detects that the vehicle's engine has turned off (indicated by a drop in vehicle power voltage), **When** this condition persists, **Then** the tablet dims its screen and pauses ad playback to avoid draining the vehicle battery.
4. **Given** the engine is detected as running again, **When** the voltage recovers, **Then** the tablet resumes normal playback automatically.
5. **Given** a capability manifest is on file, **When** the platform is selecting content for a device, **Then** it only sends media assets compatible with the reported screen resolution and available storage.

---

### Edge Cases

- What happens when a device loses connectivity mid-download? The download must resume from where it stopped without duplicating cached files.
- What happens if a device's health metrics recover after being `Flagged`? (e.g., battery is recharged above 10%): The system should automatically re-evaluate health metrics on each heartbeat and return the device to `Active` if all thresholds pass.
- What happens if two state transitions are triggered simultaneously (e.g., an admin suspends a device at the exact moment a heartbeat timeout fires)? The admin-initiated `Suspended` state must take precedence.
- What happens if a Configuration Profile is deleted while devices are assigned to it? Devices should fall back to a system default profile and an alert should be raised for the administrator.
- What happens if a tablet reports zero available storage? The sync cycle must be skipped entirely and the device flagged for low-storage intervention.
- What happens when a device UUID appears in a `Retired` blacklist and the same physical hardware is re-provisioned? It must be assigned a new UUID.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Device State Machine

- **FR-001**: The system MUST define exactly five device states: `Pending`, `Active`, `Flagged`, `Suspended`, and `Retired`.
- **FR-002**: A newly registered device MUST be assigned `Pending` state automatically upon record creation.
- **FR-003**: The system MUST transition a device from `Pending` to `Active` upon successful pairing handshake and receipt of the first heartbeat.
- **FR-004**: The system MUST automatically transition an `Active` device to `Flagged` when no heartbeat is received within a 3-minute window.
- **FR-005**: The system MUST automatically transition an `Active` device to `Flagged` when any of the following health thresholds are breached: battery level < 10%, storage utilization > 95%, or GPS precision below the defined minimum.
- **FR-006**: When a device transitions to `Flagged`, the system MUST emit a notification event to the Management App identifying the device and the triggering condition.
- **FR-007**: Only an authorized administrator MUST be able to manually transition a device to the `Suspended` state.
- **FR-008**: A `Suspended` device MUST immediately stop playing ads and be blocked from requesting or receiving new commercial media.
- **FR-009**: An authorized administrator MUST be able to reinstate a `Suspended` device to `Active`.
- **FR-010**: A device transitioned to `Retired` state MUST have its UUID permanently blacklisted; all subsequent requests from that UUID MUST be rejected.
- **FR-011**: The system MUST log every state transition with a timestamp, the previous state, the new state, and the trigger (system-automatic or administrator action).
- **FR-012**: A `Flagged` device MUST automatically return to `Active` when all health thresholds are met on the next heartbeat evaluation.

#### Configuration Profiles

- **FR-013**: Administrators MUST be able to create, update, and delete Configuration Profiles.
- **FR-014**: A Configuration Profile MUST support an **Exhibition Rules** section defining: maximum ad loop length (in seconds) and ad-to-content ratio (number of ads per non-ad content unit).
- **FR-015**: A Configuration Profile MUST support a **Connectivity Profile** with at least two modes: `Economy` (Wi-Fi only downloads) and `Premium` (any connection including cellular/5G).
- **FR-016**: A Configuration Profile MUST support a **Commercial Tier** with a configurable cost multiplier (numeric, e.g., 1.0x, 2.0x) applied to all ad CPMs for devices in the group.
- **FR-017**: Administrators MUST be able to create and manage **Device Groups** (e.g., "Airport Fleet", "Downtown Taxis", "Luxury Sedans").
- **FR-018**: Administrators MUST be able to assign one Configuration Profile to a Device Group.
- **FR-019**: The Management App MUST provide a drag-and-drop interface for moving tablet devices between Device Groups.
- **FR-020**: When a device is moved to a new group, it MUST inherit the new group's Configuration Profile within one sync cycle.
- **FR-021**: When a Configuration Profile is updated, all devices assigned to it MUST receive updated rules within one sync cycle.
- **FR-022**: When a Configuration Profile is deleted, affected devices MUST fall back to a system-defined default profile, and administrators MUST receive an alert.

#### Tablet Capability Reporting & Intelligent Sync

- **FR-023**: On pairing completion, the tablet MUST transmit a **Capability Manifest** containing: screen resolution, total storage capacity, available storage capacity, OS version, and app version.
- **FR-024**: The system MUST store and associate each device's latest Capability Manifest with its device record.
- **FR-025**: When the platform selects content for a device, it MUST filter assets to only those compatible with the device's reported screen resolution and available storage.
- **FR-026**: Before initiating any media download, the tablet MUST check available local storage. If insufficient, it MUST evict the oldest cached asset first.
- **FR-027**: The tablet MUST detect a drop in vehicle power voltage as a proxy for engine-off state.
- **FR-028**: When the engine-off state is detected, the tablet MUST dim its screen and pause ad playback within a defined grace period (default: 30 seconds).
- **FR-029**: When the engine-on state is restored (voltage recovery), the tablet MUST resume normal playback automatically.
- **FR-030**: Interrupted downloads MUST resume from the last checkpoint rather than restarting from the beginning.

### Key Entities

- **Device**: Represents a physical tablet in the fleet. Attributes: UUID (unique, permanent), current state, assigned group, paired status, last heartbeat timestamp, capability manifest reference, state transition history.
- **DeviceState**: An enumerated type representing the lifecycle phase: `Pending`, `Active`, `Flagged`, `Suspended`, `Retired`.
- **StateTransitionLog**: An immutable audit record of each state change. Attributes: device ID, previous state, new state, trigger type (system/admin), trigger detail, timestamp.
- **CapabilityManifest**: A snapshot of a device's hardware and software configuration at pairing time. Attributes: screen resolution, total storage, available storage, OS version, app version, reported timestamp.
- **ConfigurationProfile**: A reusable set of rules assignable to a Device Group. Attributes: name, exhibition rules (loop length, ad-to-content ratio), connectivity mode, commercial tier multiplier.
- **DeviceGroup**: A logical collection of devices sharing a Configuration Profile. Attributes: name, assigned profile, member device list.
- **HealthMetrics**: Real-time telemetry reported per heartbeat. Attributes: battery percentage, storage utilization percentage, GPS precision value, timestamp.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A device automatically transitions from `Active` to `Flagged` within 3 minutes of its last received heartbeat, with zero manual intervention required.
- **SC-002**: Fleet administrators can create a Configuration Profile and apply it to a device group containing 100+ devices within 2 minutes.
- **SC-003**: 100% of state transitions are recorded in the audit log with correct timestamps, previous/next states, and triggering conditions — verifiable on demand.
- **SC-004**: A `Suspended` device stops all ad playback within one heartbeat cycle (default: 60 seconds) of the suspension action.
- **SC-005**: Tablets with a Capability Manifest on file never receive media assets that exceed their reported available storage capacity.
- **SC-006**: When a tablet's storage is at 98%+ capacity during a sync cycle, it successfully evicts old content and completes the download of new media in 100% of test cases.
- **SC-007**: Drag-and-drop group reassignment in the Management App is reflected across all devices in the group within one sync cycle (≤ 60 seconds under normal connectivity).
- **SC-008**: When vehicle engine-off is detected, the tablet dims its screen and halts ad playback within 30 seconds.
- **SC-009**: A retired device UUID is rejected on all subsequent API requests with no data leakage or media access.
- **SC-010**: Configuration Profile updates propagate to all assigned devices within one sync cycle without any devices entering an error state.

---

## Assumptions

- The platform already has a device registry and a pairing handshake mechanism in place. This feature extends — not replaces — the existing pairing flow.
- "One sync cycle" is defined as a maximum of 60 seconds end-to-end under normal connectivity conditions. This value may be configurable per environment.
- The heartbeat interval is 60 seconds. The 3-minute `Flagged` threshold therefore corresponds to 3 missed consecutive heartbeats.
- GPS precision thresholds (minimum acceptable values) will be defined by the operations team and stored as system configuration; a default of HDOP ≤ 5.0 is assumed for initial implementation.
- Vehicle voltage drop as proxy for engine-off is valid for the target vehicle class (12V systems). Specific voltage threshold (e.g., < 12.4V) is a system configuration value.
- The Management App runs in a modern web browser with drag-and-drop capability (HTML5 DnD or equivalent).
- Commercial Tier multipliers apply at impression reporting time, not at content delivery time.
- A device may only belong to one Device Group at a time. Moving a device to a new group removes it from the previous group.
- The `Retired` UUID blacklist is permanent and irreversible via the standard UI. Data purge (GDPR etc.) may require a separate admin-only process.
- Download resumption is based on byte-range support from the content delivery server. If not supported, the download restarts from scratch (logged as a known limitation).
- The system default profile (fallback when a profile is deleted) is pre-configured by the platform and not user-editable.
