# Research: Device State Machine and Configuration Profiles

**Feature**: 002-device-state-machine  
**Date**: 2026-04-05  
**Status**: Complete — all unknowns resolved

---

## 1. State Machine Pattern in NestJS

**Decision**: Use a dedicated domain service (`DeviceStateMachineService`) backed by an explicit transition table rather than a generic FSM library.

**Rationale**: The state graph is small (5 states, ~8 edges) and static. Introducing a library like `xstate` or `robot` would add build-time complexity (serialisation, visualisation config) with no runtime benefit. A hand-coded guard table is simpler, auditable, and satisfies KISS/YAGNI. Every state transition guard is a single boolean predicate, unit-testable in isolation.

**Transition table**:

| From | To | Trigger |
|------|----|---------|
| `Pending` | `Active` | Successful pairing handshake + first heartbeat |
| `Active` | `Flagged` | 3-min heartbeat timeout OR health threshold breach |
| `Flagged` | `Active` | All health thresholds pass on next heartbeat evaluation |
| `Active` | `Suspended` | Admin action (authorised) |
| `Flagged` | `Suspended` | Admin action (authorised) |
| `Suspended` | `Active` | Admin action (reinstate) |
| `* (non-Retired)` | `Retired` | Admin action (permanent) |

**Alternatives considered**: `xstate v5` (rejected — too large for a 5-state machine and adds serialisation overhead), `@casl/fsm` (rejected — insufficient documentation for NestJS integration).

---

## 2. Heartbeat Timeout Detection: Scheduler vs MQTT Disconnect Event

**Decision**: Retain the `@Cron`-based `HeartbeatMonitorService` sweep (already exists) and extend it to write `DeviceLifecycleEvent` records and trigger `DeviceStateMachineService.flagDevice()`. Do NOT rely solely on MQTT broker LWT (Last Will and Testament) messages.

**Rationale**: MQTT LWT fires only on ungraceful disconnect. A device may remain MQTT-connected but silent (e.g., app crash, frozen playback). The existing 30-second cron sweep now targets 3 missed heartbeats (180 s cutoff) instead of the current 120 s. This is a config-driven value (`HEARTBEAT_FLAGGED_THRESHOLD_MS`).

**Existing service**: `heartbeat-monitor.service.ts` — update `OFFLINE_AFTER_MS` → `FLAGGED_AFTER_MS = 180_000`, change action from `markOffline()` to call `DeviceStateMachineService.transitionTo(deviceId, 'Flagged', { trigger: 'heartbeat_timeout' })`.

---

## 3. UUID Blacklist for Retired Devices

**Decision**: Store retired device UUIDs in a dedicated `RetiredDeviceRegistry` MongoDB collection (indexed on `deviceId`). Evaluate the blacklist in an `AuthGuard`/middleware layer before all API routes that accept a `deviceId` parameter.

**Rationale**: The `Device` document itself is preserved for audit compliance. Checking `device.status === 'Retired'` on every request couples the auth gate to the device data model. A separate lightweight collection (only `deviceId` + `retiredAt`) is fast to query (sub-millisecond at fleet scale) and clearly segregates concerns.

**Alternatives considered**: Redis SET for blacklist (rejected — introduces cache invalidation risk; at fleet scale the set is small enough that MongoDB indexed query is sufficient); soft-deleting the Device record (rejected — destroys audit trail required by FR-011).

---

## 4. Configuration Profiles Storage

**Decision**: Introduce two new MongoDB collections: `configuration_profiles` and `device_groups`. `DeviceGroup` has a FK reference to `ConfigurationProfile` (`profileId`). Devices carry a `groupId` field referencing `DeviceGroup`. Profile resolution follows the chain: `Device → DeviceGroup → ConfigurationProfile`.

**Rationale**: Normalisation avoids duplicating profile rules across every device record (DRY). Grouping is a separate concept from the profile content (SRP). Both are small collections (hundreds of groups, tens of profiles typical fleet).

**Alternatives considered**: Embedding profile directly in the Device document (rejected — requires updating 100s of documents on every profile edit, violating DRY); using Redis for profile config (rejected — adds cache invalidation complexity, MongoDB TTL-less data is fine here).

---

## 5. Profile Propagation Mechanism

**Decision**: When a profile or group assignment changes, the API emits an MQTT `config/update` message to the device's dedicated topic (`devices/{deviceId}/config`). The tablet subscribes to this topic and applies the new config in-memory, as well as persisting it to local storage. No polling required.

**Rationale**: MQTT is already present in the stack (existing `mqtt.service.ts`). Push-based config delivery is lower latency than polling and eliminates a periodic request loop. The tablet already maintains an MQTT connection for heartbeats.

**Alternatives considered**: REST polling (`GET /config`) by the tablet on each heartbeat cycle (rejected — adds N×heartbeat HTTP requests; MQTT push is already the architectural pattern for device communication); WebSocket (rejected — MQTT already present and more suited to IoT device communication).

---

## 6. Tablet Capability Manifest

**Decision**: The Capability Manifest is submitted via a new `PATCH /api/v1/devices/{deviceId}/capability-manifest` REST endpoint called once on pairing completion. The manifest is stored as a sub-document on the `Device` record (`capabilityManifest` field), replacing the existing `hardwareProfile` which currently only captures screen dimensions and storage capacity.

**Rationale**: The manifest extends `hardwareProfile` with `availableStorageGb` and `appVersion` — two fields required for the new content-filtering logic. Merging into the single `Device` document keeps payload lookups to one DB query per content selection decision (performance). The existing `DeviceBindRequest` contract already sends a partial manifest at bind time; this endpoint handles the fuller post-pairing refresh.

**Alternatives considered**: Separate `device_capability_manifests` collection with versioned history (rejected — YAGNI; the spec requires only the *latest* manifest; history can be added later if requested); including in the heartbeat payload (rejected — heartbeats have strict size limits optimised for frequency, not for large manifest objects).

---

## 7. Intelligent Storage Eviction Strategy

**Decision**: Implement LRU (Least Recently Used) eviction in the Tablet App. The local cache index tracks `assetId`, `sizeBytes`, and `lastPlayedAt`. Before any download, check `availableBytes - asset.sizeBytes`. If negative, evict the LRU asset(s) until space is sufficient.

**Rationale**: LRU favours assets that are still being played (recency = relevance) and naturally evicts unused campaign assets when that campaign ends. This is the simplest correct algorithm for this use case (KISS).

**Alternatives considered**: FIFO (rejected — evicts recently cached assets that may be in active rotation); LFU (rejected — more complex to implement, worse for rotating ad campaigns where frequency naturally resets per campaign period); size-aware eviction (rejected — adds complexity without clear benefit given the uniform-ish size of ad video assets).

---

## 8. Vehicle Power / Engine-Off Detection

**Decision**: The tablet reads voltage from the vehicle's OBD-II port (if available via a Bluetooth OBD-II adapter) or falls back to monitoring the Android system's `ACTION_POWER_DISCONNECTED` intent when running on USB power (charger plugged into vehicle's ACC-switched outlet).

**Rationale**: The Capacitor-based tablet app (`openad-ad-client` uses `@capacitor/android`) can register native Android broadcast receivers. The `ACTION_POWER_DISCONNECTED` intent is a zero-dependency way to detect ACC-off ignition state, which is how most in-vehicle tablets are powered. This approach works on 100% of target devices without requiring OBD-II hardware.

**Fallback**: If OBD-II voltage monitoring is added later, it is an enhancement on top of this baseline — YAGNI for v1.

**Alternatives considered**: GPS speed-based inference (rejected — GPS may be unreliable in underground car parks; speed-zero does not mean engine-off); Always-on with a manual screen-dim schedule (rejected — does not prevent battery drain in vehicles left idle for long periods).

---

## 9. Download Resumption

**Decision**: Implement HTTP byte-range resumption. The tablet stores `{ assetId, downloadedBytes, totalBytes, etag }` in its local DB. On retry, issue `GET` with `Range: bytes={downloadedBytes}-`. Validate ETag match; if mismatched, start fresh and log a warning.

**Rationale**: The CDN/S3 (already present via `@aws-sdk/client-s3`) supports byte-range requests. Resumption avoids re-downloading large video assets (500MB+) from scratch on connectivity drops, which is critical for Economy-mode devices on Wi-Fi only.

**Alternatives considered**: Chunked multi-part download with part tracking (rejected — more complex, suitable for unreliable connections; byte-range is simpler and correct for this use case).

---

## 10. Management App: Drag-and-Drop Group UI

**Decision**: Use Angular CDK (`@angular/cdk/drag-drop`) within the existing PrimeNG-based Management App (Angular 21). Device cards in the Device Group Manager will use `cdkDrag` + `cdkDropList` directives. Persistence is a `PATCH /api/v1/device-groups/{groupId}/members` call on drop.

**Rationale**: Angular CDK Drag & Drop is already an Angular dependency (no new package needed). PrimeNG has a `p-orderList` but it lacks cross-list drag support; CDK DnD is the correct primitive. The existing management app already uses Angular router and PrimeNG components.

**Alternatives considered**: PrimeNG `p-picklist` (rejected — designed for re-ordering within two lists, not group management across N groups); custom HTML5 DnD (rejected — accessibility and keyboard support require manual implementation; CDK provides this).

---

## 11. State Transition Audit Log

**Decision**: `DeviceLifecycleEvent` documents are written to a dedicated `device_lifecycle_events` collection (append-only, no update path). Schema: `{ eventId, deviceId, fromState, toState, trigger: { type: 'system'|'admin', detail: string, actorId?: string }, occurredAt }`.

**Rationale**: An immutable event log satisfies FR-011 (100% audit) and SC-003 (verifiable on demand) while enabling future analytics (MTTR, SLA compliance). Using a separate collection prevents the `Device` document from growing unbounded with transition history (SRP).

**Alternatives considered**: Embedding as a sub-array on `Device` (rejected — unbounded array growth; MongoDB document size cap); using a relational DB side-car (rejected — entire stack is MongoDB; adding Postgres for one table violates KISS and DRY).

---

## Resolved: No NEEDS CLARIFICATION Items Remain

All unknowns from the Technical Context have been resolved above. The implementation plan can proceed to Phase 1 design.
