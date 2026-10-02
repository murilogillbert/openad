# Feature Specification: End-to-End Media Orchestration Platform for Transit Advertising — System Foundation

**Feature Branch**: `001-transit-ad-platform-foundation`  
**Created**: 2026-04-04  
**Status**: Draft  
**Input**: User description: "End-to-End Media Orchestration Platform for Transit Advertising — System Foundation covering Inventory Activation, Contextual Delivery, Fleet Intelligence, and Commercial Accountability."

---

## User Scenarios & Testing *(mandatory)*

<!--
  User journeys are ordered by foundational dependency — each pillar must be independently shippable and testable.
-->

### User Story 1 — Fleet Operator: Device Onboarding & Inventory Activation (Priority: P1)

A fleet operations manager receives a new batch of tablets to install in ride-hailing vehicles. They need a reliable, secure way to register each device and bind it permanently to a specific vehicle so the system can treat that vehicle as a known, managed unit of advertising inventory.

The operator opens the management portal, initiates a device registration flow, scans or enters the vehicle identifier, and confirms the binding. The system validates the pairing, stores the vehicle's known characteristics (screen size, make/model, typical route zone), and immediately makes it discoverable as "active inventory" in the catalog.

**Why this priority**: Without device onboarding, no downstream function (scheduling, monitoring, or reporting) can operate. This is the foundation of everything — every vehicle must first be "known" to the system before it can carry any commercial value.

**Independent Test**: A fleet manager can register a single tablet-to-vehicle binding through the portal, and the vehicle immediately appears as "active" in the searchable inventory catalog — with no other system components needing to be deployed.

**Acceptance Scenarios**:

1. **Given** a new, unregistered tablet is powered on, **When** the operator initiates the binding process and submits the vehicle identifier, **Then** the system records the pairing, assigns the device a unique managed identity, and the vehicle appears in the inventory catalog with status "active."
2. **Given** an operator attempts to bind a tablet that is already bound to another vehicle, **When** the duplicate binding is submitted, **Then** the system rejects the request with a clear conflict message, leaving both existing records unchanged.
3. **Given** an active vehicle is registered in the catalog, **When** a fleet manager searches by city zone, vehicle model, or screen size, **Then** the system returns only matching vehicles with their current status and characteristics.
4. **Given** a vehicle is decommissioned, **When** the operator removes it from active inventory, **Then** all future scheduling operations exclude that vehicle and in-flight campaigns are gracefully reassigned or flagged.

---

### User Story 2 — Advertiser/Campaign Manager: Contextual Content Scheduling (Priority: P2)

An advertiser wants to run a campaign that shows a coffee-shop ad only in the downtown financial district on weekday mornings between 7 AM and 9 AM. The campaign manager logs into the portal, creates a campaign, uploads the creative asset, and defines the geo-zones, time windows, and audience rules. The system pre-positions the media file on every vehicle likely to operate within those constraints, so that when a vehicle enters the defined zone at the right time, the correct ad plays — with no buffering or delay.

**Why this priority**: This is the core commercial function of the platform. Once inventory is active (P1), the system must be able to intelligently match and deliver content against time-and-space rules. Without this, the network has no business value.

**Independent Test**: A campaign manager can create a campaign with a single geo-zone, time window, and creative asset. When a test vehicle's location is simulated within that zone during the defined window, the correct ad plays without any manual intervention.

**Acceptance Scenarios**:

1. **Given** a campaign is defined with a geographic zone, time window, and creative asset, **When** a vehicle enters the defined zone during the active time window, **Then** the system plays only the scheduled creative for that campaign without interruption.
2. **Given** a vehicle has unreliable connectivity, **When** the vehicle enters a scheduled zone, **Then** the ad plays from locally cached content without requiring a live network connection.
3. **Given** two campaigns have overlapping time windows and geo-zones with different priority levels, **When** a vehicle is within both zones simultaneously, **Then** the system resolves the conflict according to advertiser-defined priority rules and plays only one ad at a time.
4. **Given** a campaign's scheduled window expires, **When** the vehicle re-enters the formerly active zone, **Then** the expired campaign's content is no longer shown, and the system falls back to default or next-priority content.
5. **Given** a new creative asset is uploaded mid-campaign, **When** the update is submitted by the campaign manager, **Then** the system pushes the updated content to all relevant vehicles within a defined propagation window without disrupting currently playing content.

---

### User Story 3 — Fleet Administrator: Real-Time Fleet Health Monitoring & Remote Management (Priority: P3)

A fleet administrator sits at the Mission Control dashboard. They need to see — at a glance — the live status of every vehicle: its current GPS position, what content it is displaying, its connectivity health, battery/device status, and any active alerts. When a vehicle is identified as "sick" (offline, frozen, or out of sync), the administrator must be able to push a remote remediation command without physically accessing the car.

**Why this priority**: Once content delivery is live (P2), operational oversight becomes essential to maintain network health at scale. The platform cannot be commercially viable if operators must manually inspect each vehicle to verify it is running correctly.

**Independent Test**: An administrator can view the live map of all active vehicles, click on one with a health alert, and issue a remote restart command — all from the dashboard — and within a defined time window, the targeted vehicle confirms the action and resumes normal operation.

**Acceptance Scenarios**:

1. **Given** 100+ vehicles are active on the network, **When** the administrator opens the dashboard, **Then** all vehicles are visible on a live map updated at least once every 30 seconds, with color-coded health status indicators.
2. **Given** a vehicle goes offline (no status update received within a defined threshold), **When** this condition is detected by the system, **Then** the vehicle's status changes to "offline/alert" on the dashboard and the administrator receives a notification within 2 minutes.
3. **Given** an administrator identifies a vehicle with a playback error, **When** they issue a remote restart command, **Then** the command is delivered and acknowledged by the device within 5 minutes, and the vehicle's status returns to "healthy" once playback resumes.
4. **Given** a remote command is issued to a temporarily unreachable device, **When** the device reconnects, **Then** the queued command is executed automatically and the outcome is logged on the dashboard.

---

### User Story 4 — Finance/Analytics Team: Proof-of-Play Reporting & Commercial Accountability (Priority: P4)

A finance analyst and a client advertiser both need to verify that the campaign they paid for actually delivered. The analyst opens the reporting module and generates a Proof-of-Play report: a structured record of every ad impression, including the timestamp, vehicle ID, GPS coordinates at time of play, and creative asset shown. The system also produces aggregated summaries (total impressions, estimated reach, revenue earned) that are used for client billing and internal ROI calculation.

**Why this priority**: Commercial viability depends on trust. Without auditable evidence that ads were shown, advertisers cannot be billed with confidence. This pillar converts raw delivery events into business currency.

**Independent Test**: After a test campaign completes, a finance analyst can generate a Proof-of-Play report that lists each recorded impression event (time, location, vehicle, creative) and an aggregated summary (total impressions, unique zones covered, total revenue), without any manual data entry.

**Acceptance Scenarios**:

1. **Given** a vehicle plays an ad, **When** the play event occurs, **Then** the system records an immutable impression event containing: timestamp, vehicle ID, GPS coordinates, creative asset ID, and campaign ID.
2. **Given** a campaign has ended, **When** a finance analyst requests a Proof-of-Play report, **Then** the system generates a complete, exportable report within 5 minutes, covering 100% of impression events for that campaign.
3. **Given** a campaign report is generated, **When** the advertiser reviews it, **Then** the report shows total impressions, unique geographic zones reached, estimated unique passenger reach, total billable value, and a timeline of delivery.
4. **Given** a dispute arises over a specific impression event, **When** the analyst investigates, **Then** the system provides a drill-down view of the individual event record with its full contextual metadata.
5. **Given** a billing cycle closes, **When** the system finalizes billing, **Then** aggregated revenue figures per campaign and per vehicle operator are calculated and available for export.

---

### Edge Cases

- What happens when a vehicle's GPS signal is lost mid-campaign? The system must record the last known position and flag the impression event as "location-unverified" rather than dropping the record entirely.
- What if a device is stolen or replaced? The system must support emergency unbinding of a device identity and re-binding to a replacement device without losing historical campaign data.
- What if a campaign's geo-zone is drawn so broadly that it overlaps the entire operating city? The system must still enforce time-window rules and prevent infinite impression loops by defining a minimum dwell-time per impression event.
- What happens if a content file fails integrity validation after download to the device? The system retains the previous valid version and alerts the campaign manager, rather than playing a corrupted or partial file.
- What if the management platform itself is unreachable (server outage)? Devices must continue to play the last-synced schedule in offline mode for a defined grace period (assumed: 72 hours) before reverting to a default fallback slate.
- How does the system handle a vehicle that operates across multiple geo-zones in rapid succession? The scheduling engine must have a minimum-dwell-time threshold before triggering a zone-change event, to prevent rapid-fire impression logging on zone boundaries.

---

## Requirements *(mandatory)*

### Functional Requirements

**Inventory Activation**

- **FR-001**: The system MUST allow an authorized fleet operator to bind a tablet device to a specific vehicle using a unique identifier, creating a permanent managed mapping between the physical device and the vehicle record.
- **FR-002**: The system MUST store each vehicle's known characteristics at time of binding, including at minimum: screen size, vehicle make/model, and assigned operational zone.
- **FR-003**: The system MUST provide a searchable catalog of all registered vehicles, filterable by status (active, inactive, alert), geographic zone, and vehicle characteristics.
- **FR-004**: The system MUST reject duplicate device-to-vehicle bindings and surface a clear conflict notification to the operator.
- **FR-005**: The system MUST support decommissioning a vehicle from active inventory, triggering graceful handling of any in-flight campaign assignments.
- **FR-006**: Each bound device MUST receive a unique managed system identity that is used for all subsequent communications, commands, and event records.

**Contextual Content Delivery**

- **FR-007**: The system MUST allow campaign managers to define content scheduling rules that combine at minimum: geographic zone(s), time window(s), and a creative asset.
- **FR-008**: The system MUST pre-position creative content files on target devices ahead of the scheduled play window, so that playback does not depend on an active network connection at time of display.
- **FR-009**: The system MUST continuously evaluate each vehicle's real-time GPS coordinates against active campaign geo-zones and trigger content playback when zone entry conditions are met.
- **FR-010**: The system MUST enforce advertiser-defined priority rules when multiple campaigns are eligible to play simultaneously on a single vehicle, playing only one campaign at a time.
- **FR-011**: The system MUST automatically expire content playback when a campaign's time window or geo-zone conditions are no longer met, reverting to a default or next-priority content slate.
- **FR-012**: The system MUST validate the integrity of all creative assets after transfer to a device before making them eligible for playback.
- **FR-013**: The system MUST support mid-campaign creative asset updates, propagating new content to all relevant devices within a defined window without interrupting currently playing content.

**Fleet Intelligence & Remote Management**

- **FR-014**: The system MUST provide a real-time dashboard displaying the live status of all active vehicles, including: current GPS position, playback status, connectivity health, and any active alerts.
- **FR-015**: The system MUST update each vehicle's status on the dashboard at a minimum frequency of once every 30 seconds.
- **FR-016**: The system MUST automatically detect when a vehicle has not reported status within a configurable threshold and change its dashboard status to "offline/alert."
- **FR-017**: The system MUST notify fleet administrators within 2 minutes of a vehicle transitioning to "offline/alert" status.
- **FR-018**: The system MUST allow fleet administrators to issue remote commands to individual vehicles (e.g., restart, sync, clear cache) from the dashboard.
- **FR-019**: Remote commands issued to temporarily unreachable devices MUST be queued and executed automatically when the device reconnects.
- **FR-020**: All remote command executions and their outcomes MUST be logged with a timestamp, operator identity, and device response.

**Commercial Accountability**

- **FR-021**: The system MUST record an immutable impression event every time a creative asset is played, capturing at minimum: timestamp, vehicle ID, GPS coordinates, creative asset ID, and campaign ID.
- **FR-022**: Impression events recorded while GPS signal is unavailable MUST be flagged as "location-unverified" rather than discarded.
- **FR-023**: The system MUST provide a Proof-of-Play report generator that produces a complete, exportable report for any campaign, covering 100% of its recorded impression events.
- **FR-024**: Proof-of-Play reports MUST be generated within 5 minutes of a report request for any completed campaign.
- **FR-025**: The system MUST aggregate impression events into business-level metrics per campaign, including: total impressions, unique geographic zones reached, estimated unique passenger reach, and total billable value.
- **FR-026**: The system MUST support per-billing-cycle financial summaries, disaggregated by campaign and by vehicle operator, exportable for billing and payables workflows.
- **FR-027**: Individual impression event records MUST be retrievable in full detail (with all contextual metadata) for dispute resolution purposes.

### Key Entities

- **Device**: A physical tablet installed in a vehicle. Has a unique managed identity, binding status, and hardware characteristics. Is the endpoint that receives instructions and plays content.
- **Vehicle**: A physical car in the fleet. Bound to exactly one Device at a time. Has characteristics (make/model, screen size, assigned zone). Represents the "unit of inventory."
- **Campaign**: An advertiser's request to deliver a specific creative asset under specific geo-zone and time-window rules. Has a priority level, budget, and defined lifecycle (draft → active → completed).
- **Creative Asset**: A media file (video, image) associated with a campaign. Has an integrity checksum, file size, and version. Must be pre-positioned on target devices.
- **Geo-Zone**: A defined geographic boundary (polygon or radius) used to trigger content playback rules. Associated with one or more campaigns.
- **Impression Event**: An immutable record of a single ad play occurrence. Contains: timestamp, Vehicle ID, Device ID, GPS coordinates (or "location-unverified" flag), Creative Asset ID, Campaign ID.
- **Schedule Rule**: The combination of geo-zone(s), time window(s), priority level, and creative asset that governs when and where a campaign plays.
- **Fleet Status Record**: A periodic snapshot of a vehicle's state — GPS position, playback status, connectivity health, device metrics — used to power the live dashboard.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A fleet operator can complete the full device-to-vehicle binding process and see the vehicle appear as "active" in the searchable inventory catalog in under 3 minutes from initiating the registration flow.
- **SC-002**: 100% of active vehicles are visible on the live dashboard, with location and status data refreshed at least once every 30 seconds under normal operating conditions.
- **SC-003**: Vehicles playing scheduled ad content operate correctly in offline mode — using locally cached content — for a continuous period of at least 72 hours without any connection to the central platform.
- **SC-004**: The system detects a vehicle transitioning to "offline/alert" status and delivers a notification to the fleet administrator within 2 minutes of the event.
- **SC-005**: A remote command issued to an active vehicle is acknowledged and executed within 5 minutes of being sent from the dashboard.
- **SC-006**: 100% of ad play events generate an immutable impression record; zero impression events are silently discarded, including events recorded during GPS signal loss.
- **SC-007**: A Proof-of-Play report for any completed campaign is fully generated and available for export within 5 minutes of the report being requested.
- **SC-008**: No creative asset is eligible for playback on a device until its integrity has been verified post-transfer; zero corrupted or partial files are played to passengers.
- **SC-009**: The scheduling engine resolves geo-zone conflicts between concurrent campaigns and applies priority rules in under 1 second, so that passengers experience seamless, uninterrupted content transitions.
- **SC-010**: The platform supports a fleet of at least 10,000 concurrently active vehicles without degradation in dashboard refresh rate, impression recording completeness, or command delivery speed.

---

## Assumptions

- Tablets installed in vehicles are Android-based devices with sufficient local storage to hold at least 72 hours of pre-positioned creative assets for their assigned zones.
- Vehicles operate primarily within a defined metropolitan area; cross-city or multi-market operations are considered a future expansion and are out of scope for this foundation.
- GPS coordinates are provided by the device's onboard location hardware; external GPS integrations (e.g., vehicle OBD systems) are out of scope for v1.
- advertisers and campaign managers access the platform through a web-based portal; a native mobile app for campaign management is not part of this foundation.
- Each vehicle is operated by a single driver/operator identity for fleet accountability purposes; shared or pool vehicle scenarios are out of scope for v1.
- Creative assets are video or image files within platform-defined size and format limits (assumed to be enforced at upload time by the platform).
- The platform's central management layer is assumed to be always-on and highly available; platform outage recovery procedures are an operational concern beyond this spec.
- Billing rates per impression and per campaign are managed externally by an accounts team; the platform's responsibility is to produce accurate impression counts and revenue figures based on pre-configured rates, not to manage contract pricing.
- Passenger demographic profiling or biometric data collection is explicitly out of scope; "reach" metrics are estimated based on vehicle occupancy models, not individual identification.
- Regulatory compliance (data residency, advertising standards, privacy law) will vary by operating market and is the responsibility of the deployment team; this spec assumes a permissive baseline environment for v1.
