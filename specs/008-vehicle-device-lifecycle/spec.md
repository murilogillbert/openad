# Feature Specification: Vehicle lifecycle and device binding

**Feature Branch**: `008-vehicle-device-lifecycle`  
**Created**: 2026-04-14  
**Status**: Draft  
**Input**: User description: "To build a professional fleet management system, we must establish a strict Decoupled Architecture between the Hardware (Device) and the Asset (Vehicle). Vehicle lifecycle CRUD binds to the existing Device module; analytics and operational truth must remain tied to the vehicle, not transient hardware identifiers."

## Clarifications

### Session 2026-04-14

- **Q**: When a vehicle has multiple paired devices, how is the primary fleet roster binding status derived? **→ A**: **Worst-case aggregation** — the vehicle is fully operational only when **every** paired device is within the online window; if **any** paired device exceeds the offline threshold, the vehicle shows **hardware offline** (unless in shop per existing rules).
- **Q**: What is the scope of license plate uniqueness? **→ A**: **Single OpenAD fleet, among non-decommissioned vehicles only** — **no two** vehicles that are **not decommissioned** may share the same plate **in the system**; **after** a vehicle is **decommissioned**, a **new** vehicle may reuse that plate (the decommissioned record remains for history).
- **Q**: How should permissions relate to roster vs. binding and lifecycle actions? **→ A**: **Unified Fleet Admin** — one administrator capability covers roster and vehicle profile access, vehicle create/edit (plate, tier, driver, in-shop), **pair**, **unpair**, and **decommission**. There is **one** managed vehicle population (OpenAD); driver employment or external partner labels do not imply separate fleet partitions in this product scope.
- **Q**: Should pair, unpair, and decommission produce a durable audit record? **→ A**: **Yes** — each **pair**, **unpair**, and **decommission** MUST be recorded in an **audit-oriented history** (actor, time, vehicle, device as applicable), retained per product retention policy, separate from generic debug-only logs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Swap hardware without losing the vehicle’s history (Priority: P1)

Fleet administrators replace broken, stolen, or failed in-vehicle tablets. They unpair the old unit and pair a new one to the same vehicle. Campaign delivery rules, geofence history, ad impression history, and other vehicle-scoped records must remain associated with the vehicle across the swap so reporting and compliance are not reset when hardware changes.

**Why this priority**: This is the core decoupling guarantee. If this fails, fleet analytics and proof-of-play break whenever hardware is replaced.

**Independent Test**: Can be fully tested by creating a vehicle with a paired device, recording representative vehicle-scoped activity, performing unpair then pair with a different device, and confirming vehicle-level history and assignments remain intact while the new device receives the correct operational configuration for that vehicle.

**Acceptance Scenarios**:

1. **Given** a vehicle with one or more paired devices, **When** an administrator unpairs a device, **Then** that device is no longer linked to the vehicle, its operational state reflects that it is unassigned, and playback on that unit stops in favor of an onboarding/pairing experience.
2. **Given** an unassigned device and an active vehicle awaiting or accepting hardware, **When** an administrator pairs the device to the vehicle, **Then** the device becomes the vehicle’s paired hardware, inherits the vehicle’s tier-driven rules (including geofences, campaigns, and sync expectations), and the vehicle’s durable identity is unchanged.
3. **Given** a hardware swap sequence, **When** unpair and pair complete successfully, **Then** vehicle-level history (e.g., geofence and impression history tied to the vehicle) is not discarded or reset because of the swap.
4. **Given** a completed **pair** or **unpair**, **When** an administrator reviews binding audit history for that vehicle or device context, **Then** a corresponding audit entry exists with **who** performed the action, **when** it occurred, and which vehicle and device were involved, per FR-011.

---

### User Story 2 - Onboard a new vehicle before any tablet exists (Priority: P2)

When a new car joins the fleet, an administrator registers it with identifying and commercial attributes before any device is installed. The vehicle exists as a durable fleet asset in an active state but may have no paired hardware yet.

**Why this priority**: Establishes the vehicle as the permanent record and supports operational workflows where the asset is known before installation day.

**Independent Test**: Can be fully tested by registering a vehicle with required fields, confirming duplicate plates are rejected when another **non-decommissioned** vehicle already holds that plate, and confirming the record is active with no paired devices until pairing occurs.

**Acceptance Scenarios**:

1. **Given** no other **non-decommissioned** vehicle with the same license plate, **When** an administrator creates a vehicle with license plate, make/model, commercial tier, and driver assignment as supported by the product, **Then** the vehicle is created in an active state with no paired devices and is ready for later hardware pairing.
2. **Given** another **non-decommissioned** vehicle with the same license plate, **When** an administrator attempts to create another vehicle with that plate, **Then** the system rejects the creation with a clear validation outcome.
3. **Given** a **decommissioned** vehicle that still holds a license plate value on record, **When** an administrator creates a **new** vehicle reusing that plate, **Then** the system allows creation subject to the same validation rules (no conflicting **non-decommissioned** duplicate).

---

### User Story 3 - Fleet roster and binding status at a glance (Priority: P3)

Administrators need a high-density fleet view focused on vehicles (not IT asset lists), showing plate, driver, commercial tier, and a clear binding/health status so dispatch and fleet ops can see which units are fully operational, missing hardware, offline, or in the shop.

**Why this priority**: Operational visibility separates normal “waiting for install” from real incidents and reduces alert fatigue when vehicles are intentionally out of service.

**Independent Test**: Can be fully tested by seeding vehicles and device link/heartbeat states and verifying each status label matches the defined rules.

**Acceptance Scenarios**:

1. **Given** an active vehicle with one or more paired devices and **every** paired device has communicated recently within the defined online window, **When** the administrator opens the fleet roster, **Then** the vehicle shows a fully operational binding status.
2. **Given** an active vehicle with no paired devices, **When** the administrator opens the fleet roster, **Then** the vehicle shows a hardware-missing status.
3. **Given** an active vehicle with at least one paired device, **When** **any** paired device has not communicated within the offline threshold (one hour), **Then** the vehicle shows a hardware-offline status unless the vehicle is marked in shop/maintenance (worst-case across paired devices).
4. **Given** a vehicle marked for maintenance (in shop), **When** the administrator views the roster, **Then** the vehicle shows an in-shop status and offline-style alerts are suppressed for that vehicle so administrators are not spammed during expected downtime.

---

### User Story 4 - Decommission a vehicle without erasing history (Priority: P4)

When a vehicle leaves the fleet (e.g., sold or reassigned outside the program), an administrator decommissions it. The system must retain historical records for financial reconciliation and proof-of-play while removing the vehicle from active operational surfaces.

**Why this priority**: Supports compliance and billing while cleanly ending live participation.

**Independent Test**: Can be fully tested by decommissioning a vehicle that has paired devices and confirming historical data remains available for reporting while live maps, forecasting, and pairing expectations no longer treat the vehicle as active.

**Acceptance Scenarios**:

1. **Given** an active vehicle, **When** an administrator decommissions it, **Then** the vehicle is not physically erased; it transitions to a decommissioned state and remains available for historical review.
2. **Given** a decommission action on a vehicle with paired devices, **When** the action completes, **Then** each linked device is unpaired using the same behavioral expectations as manual unpair, including stopping playback and clearing locally cached ad content via remote instruction, and the vehicle no longer appears on live maps or in active campaign forecasting in the ways defined for active fleet members.
3. **Given** a completed **decommission**, **When** an administrator reviews audit history, **Then** a **decommission** audit entry exists with actor, time, and vehicle identity, per FR-011.

---

### Edge Cases

- Attempting to pair a device that is already assigned to another vehicle must fail with a clear outcome until it is unassigned or unpaired from the other vehicle.
- A vehicle may have zero or multiple paired devices (e.g., dual headrest screens). Roster binding status uses **worst-case** health across paired devices: fully operational only if **all** are online within the window; **any** device past the offline threshold yields hardware offline (unless in shop).
- Unpairing when no device is paired should complete safely without corrupting vehicle state.
- Repeated decommission requests should not duplicate destructive side effects beyond defined idempotent behavior.
- If heartbeat timestamps are missing or ambiguous, the system MUST treat the device as **not** having communicated within the online window (i.e., **offline** for roster purposes), which is consistent with the one-hour rule in the worst case; the exact rule MUST be documented in code next to binding-status derivation (see implementation: `vehicle-binding-status` helper) so operators and support have a single reference.
- Duplicate license plates are evaluated **across the single vehicle population** (OpenAD): uniqueness applies among **non-decommissioned** vehicles only, per FR-003.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST represent each **vehicle** as the durable commercial asset (identity anchored on stable vehicle facts such as license plate and program-facing attributes) and represent each **device** as replaceable in-vehicle hardware, integrated with the existing device capability area.
- **FR-002**: The system MUST enforce that a device is linked to at most one vehicle at any time, and a vehicle may be linked to zero or more paired devices simultaneously.
- **FR-003**: The system MUST prevent duplicate license plates when creating or updating vehicles such that **no two vehicles that are not decommissioned** share the same plate **in the OpenAD vehicle inventory**. **After** a vehicle is decommissioned, a **new** vehicle MAY reuse that plate (the decommissioned record remains for history).
- **FR-010**: Users who perform roster access, vehicle provisioning and edits, **pair**, **unpair**, in-shop/maintenance marking, and **decommission** MUST be covered by the **same Fleet Administrator** capability for this product scope (no separate mandatory elevated role for binding vs. roster).
- **FR-004**: On vehicle creation, the system MUST capture license plate, make/model, commercial tier, and driver assignment according to product rules, set the vehicle to an active operational state, initialize with no paired devices, and surface a clear “waiting for hardware” posture in operational views where applicable.
- **FR-005**: The system MUST provide a fleet roster oriented around vehicles (not device inventory alone), showing license plate, driver, commercial tier, and binding status using the status semantics: fully operational (active vehicle where **every** paired device, if any, has communicated within the online window), hardware missing (active vehicle with no paired devices), hardware offline (active vehicle with at least one paired device, and **any** paired device not heard from within one hour — **worst-case across devices**), and in shop (vehicle marked for maintenance, suppressing offline-style noise as specified).
- **FR-006**: The system MUST support an administrator unpair action on a vehicle profile that removes the device from the vehicle’s paired set, marks the device as unassigned, and results in the device ceasing ad playback and presenting pairing/onboarding behavior.
- **FR-007**: The system MUST support an administrator pair action that associates a device to a vehicle such that the device receives the vehicle’s tier-driven configuration including geofences, campaigns, and sync rules, without redefining the vehicle’s identity. **Pair** and **unpair** are inverse operations sharing the same audit, device lifecycle, and vehicle identity rules (FR-011, FR-002).
- **FR-008**: The system MUST ensure campaign analytics and proof-of-play semantics remain attributable to the vehicle (and vehicle-tier context), not to a single transient hardware identifier, so hardware swaps do not discard or fork the vehicle’s authoritative history for those domains.
- **FR-009**: The system MUST NOT hard-delete vehicles. Decommissioning MUST transition a vehicle to a decommissioned state, retain historical records for reconciliation and proof-of-play, unpair all linked devices with the same unpair expectations as manual unpair including remote cache clearing, and remove the vehicle from active campaign forecasting and live operational maps as appropriate for non-active fleet members.
- **FR-011**: The system MUST record each **pair**, **unpair**, and **decommission** in a **durable audit-oriented history** that is suitable for operational and dispute review, including **actor identity**, **timestamp**, **vehicle** identity, and **device** identity when a device is involved. Records MUST be retained for at least the minimum period defined by product retention policy (exact duration may be specified outside this document). This is distinct from verbose diagnostic logging intended only for engineering troubleshooting. Administrators MUST be able to **query** recent binding audit entries **per vehicle** (and per device where applicable) through the **API** and **management UI** so acceptance scenarios that refer to “reviewing” audit history are satisfiable without raw database access.

### Key Entities *(include if feature involves data)*

- **Vehicle**: The long-lived commercial asset in the **OpenAD** vehicle inventory: license plate (unique among **non-decommissioned** vehicles; reusable after decommission per FR-003), make/model, commercial tier, driver (as modeled), operational status (including active, maintenance/in shop, decommissioned), and the set of paired devices. Owns the business meaning for geofence and impression history for the program.
- **Device**: The replaceable in-vehicle unit (e.g., tablet) with assignment state (assigned vs unassigned), linkage to at most one vehicle at a time, and signals used to determine online/offline recency for roster status. When multiple devices are paired to one vehicle, roster **vehicle-level** status reflects the **least healthy** device (see FR-005).
- **Binding lifecycle audit entry**: A durable record of **pair**, **unpair**, or **decommission** actions with actor, time, and vehicle/device references as applicable (FR-011).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance testing, after a full unpair-and-pair hardware swap on a vehicle with recorded vehicle-scoped history, 100% of sampled historical records that must persist at vehicle scope remain associated with the same vehicle identifier (no accidental “new vehicle” fork solely due to hardware change).
- **SC-002**: Administrators can complete vehicle onboarding (create with tier and plate) in under 5 minutes when required fields are known, with duplicate plates always blocked before a second **non-decommissioned** vehicle is created for the same plate, and plate reuse **after decommission** allowed per FR-003.
- **SC-003**: In seeded scenarios, fleet roster binding status matches the documented rules for at least 20 representative vehicle/device combinations (online, offline past threshold, no device, in shop, **and multi-device worst-case where one device is online and another is past the offline threshold**), with zero contradictory statuses in QA review.
- **SC-004**: After decommission, sampled historical reporting views still show the vehicle’s past activity where required for reconciliation, while the vehicle does not appear as an active participant on live maps or in active forecasting checklists used for current operations.
- **SC-005**: In acceptance testing, **100%** of sampled **pair**, **unpair**, and **decommission** actions produce a reviewable audit entry meeting FR-011 (actor and time present; vehicle present; device present when applicable).

## Assumptions

- **Fleet Administrator** is a **single** capability set for this scope: fleet roster and vehicle profiles, vehicle create/edit (plate, tier, driver, in-shop), **pair**, **unpair**, and **decommission** (see FR-010); driver-facing flows are out of scope unless already covered elsewhere.
- There is **one** vehicle and device population under **OpenAD** (no separate “client fleet” partitions in this specification). Who a driver works for externally does not create additional fleet boundaries in the product.
- An existing device registry and remote operational channel (for example commands that devices already understand) exists; this feature defines behaviors and outcomes, not wire protocols.
- “Online” for roster purposes is derived from recent device communication; the one-hour offline threshold is a product constant for this specification unless changed by a future requirements revision.
- **Commercial tier** (`commercialTier`) is the product field for tier-driven rules (FR-004, FR-005) in API, persistence, and UI.
- How long audit entries are kept (years vs. months) follows a **product retention policy**; FR-011 requires durability and minimum reviewability, not a specific storage technology.
