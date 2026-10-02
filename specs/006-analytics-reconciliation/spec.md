# Feature Specification: Analytics & Reconciliation Engine

**Feature Branch**: `006-analytics-reconciliation`  
**Created**: 2026-04-05  
**Status**: Draft  
**Input**: User description: Analytics & Reconciliation Engine — transition of data from Edge (tablet) to Core (accounting/reporting); atomic play records; buffered ingestion; reconciliation; commercial KPIs; fraud detection; pacing feedback.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ingest high-fidelity playback events (Priority: P1)

Fleet and accounting stakeholders need every ad play represented as a single, immutable **play record** with enough context (time, place, device, campaign, trigger reason, environment) to support billing and audits—not aggregate counts alone.

**Why this priority**: Without authoritative play records, nothing downstream (reconciliation, revenue, fraud) can be trusted.

**Independent Test**: Replay or simulate batched uploads from a device; verify each accepted play record is stored once with required fields and cannot be altered after acceptance.

**Acceptance Scenarios**:

1. **Given** a device completes an ad play, **When** the play is committed on the edge, **Then** a play record exists with start and end timestamps, start and end coordinates, device, vehicle, campaign, trigger reason (geofence entry, standard loop, or admin force), and environment snapshot (battery level, network type, GPS accuracy).
2. **Given** connectivity is intermittent, **When** the device accumulates many plays locally, **Then** plays are only transmitted in batches when connection is stable enough for upload (not necessarily immediately after each play).
3. **Given** a batch upload reaches the core, **When** the core acknowledges receipt, **Then** processing does not block on heavy downstream work during peak load (ingestion is decoupled from reconciliation).

---

### User Story 2 - Reconcile plays for billing integrity (Priority: P2)

Finance and operations need plays **reconciled** against campaign rules so billing uses only valid, non-duplicated, full-duration plays that occurred in allowed geography.

**Why this priority**: Directly protects revenue accuracy and dispute resolution.

**Independent Test**: Submit overlapping or duplicate batches and partial-duration plays; verify billable set excludes duplicates and partial plays, and geofence consistency is checked against authoritative zone definitions.

**Acceptance Scenarios**:

1. **Given** the same logical play is submitted twice (e.g., after a crash retry), **When** records share the same unique event identity from the edge, **Then** only one billable outcome is retained.
2. **Given** a play record shows duration shorter than the scheduled asset duration (e.g., skip or crash), **When** reconciliation runs, **Then** the play is classified as partial and **excluded** from billable impressions.
3. **Given** a play claims a geofence-related trigger, **When** server-side verification runs, **Then** start/end coordinates are checked against the campaign’s geographic rules; inconsistent plays are rejected or flagged for non-billing use.

---

### User Story 3 - Commercial metrics for the management experience (Priority: P3)

Campaign managers need **impressions**, **reach**, and **revenue** views derived from reconciled plays so they can steer spend and inventory.

**Why this priority**: Drives day-to-day operational decisions after data integrity (P1–P2) exists.

**Independent Test**: For a known set of reconciled plays across vehicles and campaigns, verify impression totals, distinct-vehicle reach per campaign, and per-play cost lines match defined business rules.

**Acceptance Scenarios**:

1. **Given** reconciled valid plays for a campaign, **When** a user views campaign analytics, **Then** impression count reflects full-duration, billable plays only.
2. **Given** the same campaign, **When** reach is displayed, **Then** it equals the count of **distinct vehicles** that delivered at least one valid play for that campaign in the selected window.
3. **Given** pricing rules include device multipliers and zone- or time-based costs, **When** revenue is computed per play, **Then** each line uses the multipliers and zone cost **as of the play timestamp**.

---

### User Story 4 - Integrity and fraud signals (Priority: P4)

Trust and risk teams need the system to **surface suspicious patterns** (e.g., plays inconsistent with device liveness or physics) for review without blocking all traffic.

**Why this priority**: Reduces fraud loss but depends on stable ingestion and reconciliation.

**Independent Test**: Inject scenarios with mismatched heartbeat density, implausible movement between start/end GPS for the play duration, and plays during apparent display-off conditions; verify appropriate flagging or exclusion per policy.

**Acceptance Scenarios**:

1. **Given** a time window, **When** plays from a device greatly exceed plausible **liveness signals** (e.g., heartbeats) for that period, **Then** those plays or the window are **flagged for manual audit** (not silently accepted as normal).
2. **Given** start and end GPS for a single play duration, **When** implied speed exceeds a defined physical threshold for that duration, **Then** the play is **flagged or rejected** as fraudulent movement.
3. **Given** environment data indicates the display was off or strongly dimmed during a reported play, **When** blackout rules apply, **Then** the play is **discarded** from billable metrics.

---

### User Story 5 - Campaign pacing feedback (Priority: P5)

When a campaign nears its budget limit, operations need **delivery pressure reduced automatically** so overspend and make-goods are avoided.

**Why this priority**: Important for cost control but builds on accurate cumulative spend from prior stories.

**Independent Test**: Simulate cumulative spend reaching a high fraction of daily budget; verify downstream scheduling or priority reflects reduced weight for that campaign until the next planning cycle.

**Acceptance Scenarios**:

1. **Given** a campaign has reached **approximately 95%** of its **daily** budget (per organizational definition), **When** the analytics view of spend is updated, **Then** a signal exists for the core to **lower effective delivery priority** on the next content delivery update for that campaign.
2. **Given** budget headroom returns (e.g., new day or budget increase), **When** pacing is recalculated, **Then** priority reduction is lifted per policy.

---

### Edge Cases

- Device offline for extended periods: large backlogs flush in multiple batches; ordering and idempotency preserved via unique event identity.
- Clock skew between edge and core: reconciliation uses consistent rules (e.g., server receive time vs. record timestamps) as defined in policy [assumption: bounded skew handling].
- Campaign or zone definitions change mid-day: which version applies to a play is determined by effective-dating rules [assumption: play timestamp binds to applicable campaign and zone version].
- Partial batch failure: some plays accepted, others rejected; operator can see per-record outcomes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST capture each ad play as an **immutable play record** after acceptance, including start and end timestamps, start and end latitude/longitude, device identifier, vehicle identifier, campaign identifier, trigger reason (geofence entry, standard loop, or admin force), and environment snapshot (battery level, network type, GPS accuracy).
- **FR-002**: The edge MUST assign a **unique event identity** per play so the core can recognize duplicates across retries.
- **FR-003**: The edge MUST buffer play records locally and MUST upload them in **batches** (within an organization-defined size range) rather than requiring one network request per play.
- **FR-004**: The edge MUST defer bulk upload when connectivity or device load conditions would risk failed or wasteful transfers [assumption: specific thresholds defined in operational policy].
- **FR-005**: The core MUST accept batch uploads and MUST hand them off for **asynchronous processing** so initial receipt stays fast under peak concurrent device load.
- **FR-006**: The core MUST deduplicate plays using the edge-generated unique event identity so duplicate batches do not create duplicate billable plays.
- **FR-007**: The core MUST classify plays whose observed duration is **materially shorter** than the scheduled asset duration as **partial** and MUST exclude them from **billable** impressions.
- **FR-008**: The core MUST verify geofence-related plays against **authoritative** geographic campaign rules and MUST exclude or flag plays that fail verification.
- **FR-009**: The system MUST compute **billable impression counts** from reconciled, full-duration, geofence-valid plays only.
- **FR-010**: The system MUST compute **reach** per campaign as the number of **distinct vehicles** with at least one valid play in the selected scope.
- **FR-011**: The system MUST compute **revenue** (or cost) per play using **device multipliers** and **zone cost** (or equivalent pricing dimensions) **effective at the play timestamp**.
- **FR-012**: When a campaign reaches **approximately 95%** of its **daily** budget, the system MUST emit a **pacing signal** so the core can **reduce delivery priority** on the next applicable content update (see Assumptions for definition of “daily”).
- **FR-013**: The system MUST cross-reference play volume against **device liveness signals** over the same windows and MUST flag **material mismatch** for manual review.
- **FR-014**: The system MUST flag plays where implied speed between start and end position for the play duration exceeds an **organization-defined** physical threshold (example: start/end positions far apart for a short creative duration).
- **FR-015**: When available, the system MUST use **display state** indicators (e.g., light level or power draw proxies) to **discard** plays that occur when the display was off or unusably dim, per policy.

### Key Entities

- **Play record**: Single immutable facts of one play attempt: temporal bounds, spatial bounds, identities, trigger reason, environment snapshot, unique event identity, reconciliation outcome.
- **Batch upload**: Group of play records sent together from a device with compression as an operational efficiency measure [assumption: lossless compression acceptable for integrity].
- **Reconciliation outcome**: Per-record classification: accepted billable, partial, duplicate, geofence failed, fraud flagged, blackout discarded, etc.
- **Commercial aggregate**: Campaign-scoped metrics: impressions, reach, revenue/cost over a time range.
- **Pacing signal**: Campaign identifier, budget period, utilization fraction, recommended priority adjustment.
- **Integrity flag**: Audit item linking suspicious plays or windows to reasons (heartbeat mismatch, velocity anomaly, blackout).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a controlled test corpus, **100%** of intentionally duplicate plays (same unique event identity) result in **at most one** billable play.
- **SC-002**: Plays shorter than the configured minimum duration threshold for “full play” are **never** counted in billable impressions.
- **SC-003**: For any campaign and reporting window, **reach** reported to users equals the count of **distinct vehicles** with ≥1 valid play in that window (verified by independent query of reconciled data).
- **SC-004**: When simulated fraud scenarios (implausible movement, blackout) are injected, **100%** are either excluded from billing or appear on an **audit queue**—none pass silently as normal billable plays.
- **SC-005**: Under a load test simulating **concurrent peak** device uploads, the **initial receipt step** remains **responsive** (organization-defined latency target for acceptance) while processing continues asynchronously.
- **SC-006**: When cumulative daily spend crosses the **~95%** threshold, operators observe **reduced delivery priority** on the **next** scheduling or manifest update cycle for that campaign (within an organization-defined maximum delay).

## Assumptions

- Campaigns, vehicles, devices, and geographic zones are **mastered** in the core; reconciliation references those definitions by identifier and effective dates.
- **Asset duration** for “full play” comparison is available from campaign or media scheduling data the analytics layer can join by reference.
- A play is treated as **partial** (FR-007) when observed duration is **materially shorter** than scheduled asset duration: by default this means **below a configured minimum percentage** (e.g. 90–95%) of expected duration **or** below a **minimum absolute seconds** floor—values are **configured per campaign or media asset** so reconciliation remains testable and auditable.
- **Device multiplier** and **zone cost** rules are maintained by commercial operations; analytics applies them deterministically per play timestamp.
- **Liveness signals** (e.g., periodic device health messages) are retained with enough history to compare against play counts in a window.
- **Daily budget** for pacing (FR-012) is evaluated on a **calendar day** in the **campaign’s configured time zone** unless otherwise specified by product policy.
- Edge batching and compression are **lossless** with respect to payload integrity (no dropped fields).
