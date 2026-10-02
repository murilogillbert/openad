# Feature Specification: Geospatial Intelligence & Triggering Engine

**Feature Branch**: `005-geospatial-triggering-engine`  
**Created**: 2026-04-05  
**Status**: Draft  
**Input**: User description: "Geospatial Intelligence & Triggering Engine — fleet interaction with the physical city; GPS becomes commercial actions. Server-side geometry (circles, polygons, overlapping zones, priority); spatial manifest to devices; tablet edge engine (monitor, entry vs dwell, arbitration); smart sensing (adaptive polling, smoothing, dead reckoning); geospatial ledger (spatial receipts, residency); refined tiers, scoring, collisions, shadow queue, hysteresis, lost-opportunity telemetry."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define spatial zones and commercial rules (Priority: P1)

Operations and commercial teams define where and how ads may apply: simple proximity around a point, or custom area shapes for neighborhoods and corridors. Multiple zones may overlap; each zone and campaign carries priority so the system can resolve conflicts consistently. The system distributes a **spatial manifest** to each vehicle that includes geometry, transition rules (when an ad may fire), and which creative applies.

**Why this priority**: Without authoritative zone definitions and a distributable spatial rule set, no downstream triggering or accountability can exist.

**Independent Test**: Can be validated by defining overlapping zones with different priorities, loading the resulting manifest onto a test device profile, and confirming the device receives complete geometry, rules, and creative references without requiring live GPS.

**Acceptance Scenarios**:

1. **Given** a new proximity zone (center + radius), **When** it is saved and published, **Then** it appears in the spatial manifest for applicable vehicles with correct geometry and priority metadata.
2. **Given** a polygonal zone for a named corridor, **When** it overlaps a broader city-wide zone, **Then** both are present in the manifest and each carries a priority score so the engine can resolve overlap.
3. **Given** zone entry/exit and dwell parameters for a creative, **When** the manifest is generated, **Then** those transition rules are included alongside the associated creative identifier.

---

### User Story 2 - Real-time spatial triggering on the vehicle (Priority: P1)

While the vehicle moves, the in-vehicle experience decides **locally** whether the current position satisfies zone geometry and trigger rules—without requesting a server decision on every movement. A **geofence monitor** compares ongoing location estimates to the cached spatial manifest. Triggers support **entry** (fire on boundary crossing) and **dwell** (fire only after remaining inside for a configured duration). When several creatives are valid, the engine applies a **rotation strategy** (sequential, weighted random, or priority-first) so delivery stays fair and predictable.

**Why this priority**: This is the core “GPS to commercial action” behavior the business depends on.

**Independent Test**: Using a replayed or simulated route, verify entry vs dwell behavior, rotation among peers, and that playback choices do not depend on continuous server calls during the drive.

**Acceptance Scenarios**:

1. **Given** a dwell-only rule, **When** the vehicle briefly crosses a zone without meeting dwell time, **Then** the associated creative does not play for that pass.
2. **Given** an entry rule, **When** the vehicle crosses from outside to inside, **Then** the creative becomes eligible per policy without waiting for a server round-trip.
3. **Given** multiple eligible creatives in the same tier, **When** rotation is set to sequential, **Then** order follows the defined sequence across repeated eligible events.

---

### User Story 3 - Stable sensing and responsible playback (Priority: P2)

Location updates are expensive and noisy. The system adapts how often it obtains a new fix based on motion (faster sampling when moving quickly, slower when stationary). Raw fixes are smoothed to reduce false boundary crossings when stopped or at signal jitter. When GPS is temporarily lost, the system uses last known motion to estimate position until signal returns. Playback may be **velocity-gated** (e.g., require low speed in certain zones) or **silenced at high speed** per policy to align with distraction and safety expectations.

**Why this priority**: Reduces battery drain, bad triggers, and compliance risk without changing core zone definitions.

**Independent Test**: Replay traces with injected noise and dropouts; verify fewer spurious triggers after smoothing and that high-speed silencing engages when configured.

**Acceptance Scenarios**:

1. **Given** a stationary vehicle with noisy fixes near a boundary, **When** smoothing and hysteresis are active, **Then** spurious enter/exit toggling stays below an agreed threshold in test harnesses.
2. **Given** loss of GPS in a tunnel, **When** dead-reckoning is enabled, **Then** position estimates continue within a bounded error until reacquisition or timeout.
3. **Given** a configured maximum speed for playback, **When** speed exceeds that threshold, **Then** new spatial triggers are suppressed or content is shortened per policy.

---

### User Story 4 - Geospatial ledger and inventory insight (Priority: P2)

Every geofenced play produces a **spatial receipt**: start and end coordinates, and reported accuracy at time of play. The system also tracks **time available in zone** (residency) even when no ad plays, to support forecasting (e.g., available screen-hours in a district). **Lost-opportunity** events are recorded when a zone would have triggered but a higher-priority creative or policy suppressed it.

**Why this priority**: Enables commercial accountability, pricing, and inventory conversations with advertisers.

**Independent Test**: After controlled drives, analysts can retrieve receipts, residency totals, and suppression reasons for a zone and time window.

**Acceptance Scenarios**:

1. **Given** a completed geofenced play, **When** reporting is queried, **Then** the record includes start and end position and accuracy at playback.
2. **Given** a vehicle present in a zone without a play, **When** residency is aggregated, **Then** the available time in zone is attributable for forecasting.
3. **Given** a lower-priority trigger suppressed by a higher tier, **When** logs are reviewed, **Then** a lost-opportunity entry explains which candidate was suppressed and why.

---

### User Story 5 - Tiered arbitration and collision handling (Priority: P2)

Not all campaigns are equal. The engine applies a **priority stack** before fine-scoring: Tier 1 emergency/public safety overrides; Tier 2 premium guaranteed delivery; Tier 3 standard proximity; Tier 4 run-of-fleet filler. If Tier 1 or 2 is ready for the current context, lower tiers are not considered. Within a tier, multiple candidates receive a **dynamic score** combining pacing (behind/on schedule), inverse distance to an epicenter, and heading alignment (e.g., favor creatives ahead of the vehicle). **Collisions** (new zone becomes relevant during playback) defer interruption unless Tier 1 requires it; otherwise the current spot completes (“loop locking”) and higher-priority intent is queued. A **shadow queue** of upcoming intents refreshes periodically from trajectory. **Hysteresis** (exit buffer) and **re-trigger cooldown** reduce repeat plays and edge flicker.

**Why this priority**: Protects guaranteed revenue, passenger experience, and fair delivery under overlap.

**Independent Test**: Scenario tests with overlapping tiers, mid-play zone entry, and cooldown timers verify tier precedence, non-destructive collision handling (except true emergency override), and cooldown enforcement.

**Acceptance Scenarios**:

1. **Given** Tier 2 and Tier 4 candidates both eligible, **When** arbitration runs, **Then** Tier 4 is not selected.
2. **Given** a clip is playing and a higher non-emergency tier becomes relevant, **When** collision rules apply, **Then** the current clip completes before the higher-priority item is inserted (unless emergency policy says otherwise).
3. **Given** a media item played recently, **When** cooldown has not elapsed, **Then** the same creative does not re-trigger from edge rules even if position re-enters.

---

### Edge Cases

- Vehicle idles on a boundary with traffic creep: hysteresis and cooldown prevent repeated triggers.
- Simultaneous entry into nested zones: tier and score decide winner; ties broken by declared rotation mode.
- GPS denial for extended period: dead reckoning degrades gracefully; triggers may pause when uncertainty exceeds policy.
- Zero eligible creatives after filtering: fallback behavior (e.g., general network content) remains unchanged from baseline product behavior.
- Emergency override during playback: only Tier 1 may interrupt mid-play; proof-of-play rules must still support audit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support defining zones as **circular radials** (center point + radius) and **polygonal enclosures** (closed boundary regions).
- **FR-002**: The system MUST allow **overlapping zones** and MUST assign each zone or campaign a **priority score** (and tier) used for arbitration.
- **FR-003**: The system MUST distribute to each vehicle a **spatial manifest** containing geometry, transition rules (entry, exit, dwell), associated creative identifiers, and weights needed for arbitration (including pacing and priority weight factors).
- **FR-004**: The in-vehicle engine MUST evaluate location against the cached manifest **locally** without requiring a server decision for each movement update.
- **FR-005**: The engine MUST support **entry triggers** (on boundary crossing) and **dwell triggers** (after continuous presence for a configured duration).
- **FR-006**: When multiple creatives are eligible within the same tier, the engine MUST support **rotation strategies**: sequential, weighted random, and priority-first, as configured.
- **FR-007**: The system MUST implement adaptive location sampling: more frequent updates when moving quickly, less frequent when stationary, within operator-configured bounds.
- **FR-008**: The system MUST apply **signal smoothing** to location estimates to reduce false boundary events from jitter.
- **FR-009**: When GPS is unavailable, the system MUST support **dead-reckoning** using last known velocity and heading until reacquisition or a defined timeout.
- **FR-010**: The system MUST enforce **hysteresis** (e.g., exit buffer distance) so leaving a zone is recognized only after crossing a buffer beyond the nominal boundary.
- **FR-011**: The system MUST maintain a **per-creative or per-rule last-played** (or cooldown) memory to enforce **re-trigger cooldown** and frequency capping at the edge.
- **FR-012**: The system MUST support **velocity-gated** rules (e.g., require low speed for certain zones) and **high-speed silencing** or shortened content per policy.
- **FR-013**: For every geofenced play, reporting MUST capture a **spatial receipt**: coordinates at start and end of play, and reported accuracy (margin of error) at playback time.
- **FR-014**: The system MUST record **zone residency** (time available in zone) for forecasting, including intervals when no ad played.
- **FR-015**: The system MUST log **lost opportunities** when a geofence trigger is suppressed by a higher-priority candidate or policy, with enough context for sales analysis.
- **FR-016**: Arbitration MUST apply **tier ordering**: Tier 1 emergency/public safety, Tier 2 premium guaranteed, Tier 3 proximity geofenced, Tier 4 run-of-fleet—lower tiers MUST NOT win when a higher tier has a ready candidate (subject to FR-017 for emergency interrupt).
- **FR-017**: **Loop locking**: normal playback MUST NOT be cut off mid-clip for non-emergency tiers; Tier 1 MAY interrupt when policy requires.
- **FR-018**: The in-vehicle engine MUST maintain a **shadow queue** of upcoming candidates refreshed periodically from recent trajectory and zone projections.
- **FR-019**: Within-tier scoring MUST combine **pacing**, **inverse distance** to a defined epicenter, and **heading alignment**, using configurable weights set via the management experience.
- **FR-020**: Management MUST be able to configure arbitration weights, dwell durations, cooldowns, hysteresis buffers, speed thresholds, and rotation modes for applicable campaigns and zones.

### Key Entities

- **Spatial zone**: A named region (circle or polygon), tier, priority score, and linkage to campaigns and creatives.
- **Spatial manifest bundle**: The vehicle-facing package of geometries, rules, creative references, and weights for arbitration.
- **Trigger rule**: Entry, dwell, cooldown, velocity gates, and rotation assignment for a creative in a zone context.
- **Spatial receipt**: Audit record for a play with start/end position and accuracy.
- **Residency interval**: Time spent inside a zone for inventory forecasting, with or without a play.
- **Lost-opportunity event**: Suppressed candidate with reason (e.g., higher tier won).
- **Shadow queue**: Ordered upcoming candidates derived from current motion and manifest.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In standardized replay tests with boundary noise, **false enter/exit events** are reduced by **at least 50%** versus raw fixes, while true crossings remain detected within one sampling window of ground truth.
- **SC-002**: **100%** of geofenced plays that are billed or reported externally include a complete spatial receipt (start, end, accuracy).
- **SC-003**: For configured dwell rules, **0%** of plays fire when dwell time is **more than 10% below** the configured threshold in simulation (i.e., drive-by suppression works).
- **SC-004**: In tiered overlap scenarios, **100%** of test cases select a Tier 3/4 creative **only when** no Tier 1/2 candidate is ready per rules.
- **SC-005**: Operators can create and publish **both** circle and polygon zones **without** manual engineering support, in under **30 minutes** for a typical metro zone (training time excluded).
- **SC-006**: Fleet analytics can report **available screen-hours per zone** for a chosen week within **one business day** of data collection (processing latency target).
- **SC-007**: After deployment, **lost-opportunity** logs allow identifying **which** lower-tier campaign was suppressed in **at least 90%** of suppression events in field pilot review (by count).

## Assumptions

- “Emergency” Tier 1 content is supplied only through **authorized** safety and public-alert channels; scope of message types follows existing legal and partner agreements.
- Speed and distraction policies are **configurable by market**; defaults follow operator policy templates rather than a single global law.
- Residency and receipt data retention follows **existing fleet analytics retention** (e.g., 12–24 months) unless a separate privacy program shortens it.
- Vehicles already receive periodic manifest updates; this feature **extends** manifest content with spatial arbitration fields rather than replacing unrelated scheduling features.
- Smoothing uses a bounded history of recent samples; more advanced estimators may be introduced if field metrics require.
