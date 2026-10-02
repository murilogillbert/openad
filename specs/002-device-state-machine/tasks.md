# Tasks: Device State Machine and Configuration Profiles

**Input**: Design documents from `/specs/002-device-state-machine/`  
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/api.md ✅ | quickstart.md ✅

**Tests**: Included — TDD is NON-NEGOTIABLE (Constitution Principle VI). Write every test BEFORE the implementation it covers. Verify tests FAIL (Red) before implementing (Green).

**Organization**: Tasks grouped by user story enabling independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Extend domain types, contracts libraries, and MongoDB schemas that every subsequent phase depends on.

**⚠️ CRITICAL**: These tasks must be completed before ANY user story work begins.

- [X] T001 Extend `libs/domain/src/lib/entities.ts` — add `DeviceLifecycleState` enum, `CapabilityManifest`, `HealthMetrics`, `EventTriggerType`, `DeviceLifecycleEventTrigger`, `DeviceLifecycleEvent`, `RetiredDeviceRegistryEntry`, `ConnectivityMode`, `ExhibitionRules`, `ConfigurationProfile`, and `DeviceGroup` types; update `Device` interface fields (`lifecycleState`, `groupId`, `capabilityManifest`, `lastHealthMetrics`); keep `DeviceStatus` as a deprecated alias until migration is complete
- [X] T002 [P] Extend `libs/api-contracts/src/lib/types.ts` — add all new REST request/response interfaces from `contracts/api.md`: `DeviceStateTransitionRequest`, `DeviceStateTransitionResponse`, `DeviceLifecycleEventsResponse`, `CapabilityManifestUpdateRequest`, `CapabilityManifestUpdateResponse`, `CreateConfigurationProfileRequest`, `ConfigurationProfileResponse`, `CreateDeviceGroupRequest`, `DeviceGroupResponse`, `GroupMembershipUpdateRequest`, `GroupMembershipUpdateResponse`, `DeviceStateChangedEvent`, `ConfigSyncCompleteEvent`; import new `DeviceLifecycleState` from `@openad/domain`
- [X] T003 [P] Extend `libs/mqtt-contracts/src/lib/` — add `HeartbeatPayload` interface (extended with `health` field), `DeviceConfigPayload` interface, and `PowerStatePayload` interface; export all from `index.ts`
- [X] T004 Create `app/openad-api/src/modules/devices/device-lifecycle-event.schema.ts` — Mongoose schema for `device_lifecycle_events` collection: fields `eventId`, `deviceId`, `fromState`, `toState`, `trigger` (sub-doc: `type`, `detail`, `actorId?`), `occurredAt`; add indexes `{ deviceId: 1, occurredAt: -1 }`, `{ occurredAt: -1 }`, `{ toState: 1, occurredAt: -1 }`
- [X] T005 [P] Create `app/openad-api/src/modules/devices/retired-device-registry.schema.ts` — Mongoose schema for `retired_device_registry` collection: fields `deviceId` (unique), `retiredAt`, `retiredByAdminId`; add unique index `{ deviceId: 1 }`
- [X] T006 [P] Create `app/openad-api/src/modules/configuration-profiles/configuration-profile.schema.ts` — Mongoose schema for `configuration_profiles` collection: fields `profileId` (unique), `name` (unique index), `exhibitionRules` (sub-doc: `maxLoopLengthSeconds`, `adToContentRatio`), `connectivityMode` (enum), `commercialTierMultiplier`, `isDefault`, timestamps; add indexes `{ isDefault: 1 }`, `{ name: 1 }`
- [X] T007 [P] Create `app/openad-api/src/modules/device-groups/device-group.schema.ts` — Mongoose schema for `device_groups` collection: fields `groupId` (unique), `name` (unique index), `profileId`, timestamps; add indexes `{ name: 1 }`, `{ profileId: 1 }`
- [X] T008 Update `app/openad-api/src/modules/devices/devices.schema.ts` — add fields: `lifecycleState` (enum of 5 states, replaces existing `status`), `groupId` (nullable string), `capabilityManifest` (sub-document replacing `hardwareProfile`, adds `availableStorageGb` and `appVersion`), `lastHealthMetrics` (nullable sub-document); add new indexes: `{ lifecycleState: 1, groupId: 1 }`, `{ 'capabilityManifest.availableStorageGb': 1 }`; keep `status` field as deprecated until data migration runs

**Checkpoint**: Shared types, contracts, and schemas are in place — all subsequent phases can build on them.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core services and guards that every feature phase depends on — the NestJS guard, repositories, and the FSM core.

**⚠️ CRITICAL**: No user story implementation can start until this phase is complete.

- [X] T009 Write failing unit tests for `DeviceStateMachineService` in `app/openad-api/src/modules/devices/device-state-machine.service.spec.ts` — one test per row of the state transition matrix (8 valid transitions) plus tests for all invalid transitions (≥ 15 invalid pairs); tests call `transitionTo(deviceId, toState, trigger)` and assert either resolved `DeviceLifecycleEvent` or thrown `InvalidTransitionException`; tests must FAIL before T010 is implemented
- [X] T010 Implement `DeviceStateMachineService` in `app/openad-api/src/modules/devices/device-state-machine.service.ts` — inject `DevicesRepository`, `DeviceLifecycleEventsRepository`, `RetiredDeviceRegistryRepository`, `PinoLogger`; implement `transitionTo(deviceId, toState, trigger)` method that: (1) fetches current device state, (2) validates transition against the allowed matrix, (3) throws `InvalidTransitionException` for invalid pairs, (4) updates `device.lifecycleState`, (5) appends `DeviceLifecycleEvent` record, (6) if `toState === 'Retired'` inserts into `retired_device_registry`; all operations are structured-logged with event key `device.state.transition`
- [X] T011 [P] Create `app/openad-api/src/modules/devices/device-lifecycle-event.repository.ts` — Mongoose-backed repository wrapping `device_lifecycle_events`; methods: `create(event)`, `findByDevice(deviceId, pagination)`, `findAll(filter)` — used by `DeviceStateMachineService` and lifecycle event list endpoint
- [X] T012 [P] Create `app/openad-api/src/modules/devices/retired-device-registry.repository.ts` — Mongoose-backed repository wrapping `retired_device_registry`; methods: `insert(entry)`, `exists(deviceId): Promise<boolean>` — used by `RetiredDeviceGuard` and `DeviceStateMachineService`
- [X] T013 Write failing unit test for `RetiredDeviceGuard` in `app/openad-api/src/modules/devices/retired-device-guard.spec.ts` — test cases: (a) request with a retired `deviceId` → `canActivate()` returns `false` / throws `ForbiddenException`; (b) request with a non-retired `deviceId` → `canActivate()` returns `true`; tests must FAIL before T014
- [X] T014 Implement `RetiredDeviceGuard` in `app/openad-api/src/modules/devices/retired-device-guard.ts` — NestJS `CanActivate` guard; injects `RetiredDeviceRegistryRepository`; extracts `deviceId` from route param or request body; calls `repository.exists(deviceId)`; if `true`, throws `ForbiddenException('Device is retired and blacklisted')`; decorated with `@Injectable()`
- [X] T015 [P] Create `app/openad-api/src/modules/configuration-profiles/configuration-profiles.repository.ts` — Mongoose-backed repository; methods: `create(profile)`, `findAll(pagination)`, `findById(profileId)`, `findByName(name)`, `findDefault()`, `updateById(profileId, patch)`, `deleteById(profileId)`, `reassignGroupsFromDeletedProfile(deletedProfileId, defaultProfileId)`
- [X] T016 [P] Create `app/openad-api/src/modules/device-groups/device-groups.repository.ts` — Mongoose-backed repository; methods: `create(group)`, `findAll(pagination)`, `findById(groupId)`, `findByProfileId(profileId)`, `updateById(groupId, patch)`, `deleteById(groupId)`, `getMemberCount(groupId): Promise<number>`; member queries use `devices.find({ groupId: groupId })`

**Checkpoint**: FSM, guard, and repositories are operational — user story phases may now begin in parallel.

---

## Phase 3: User Story 1 — Device Lifecycle State Management (Priority: P1) 🎯 MVP

**Goal**: Every device has a formal lifecycle state; automatic transitions fire on heartbeat timeout and health threshold breaches; all transitions are logged; admin can suspend/retire devices; retired UUIDs are permanently blocked.

**Independent Test**: Provision a device → observe `Pending`; complete pairing + send heartbeat → observe `Active`; withhold heartbeat for 3 min → observe `Flagged` with notification event emitted; admin suspends → device immediately stops serving ads; admin retires → UUID rejected on all subsequent requests.

### Tests — User Story 1 (write BEFORE implementation, verify RED)

- [X] T017 [P] [US1] Write failing integration test for `PATCH /api/v1/devices/{deviceId}/state` in `app/openad-api-e2e/src/devices/device-state-transition.spec.ts` — test suite covering: (a) `Active → Suspended` by admin returns 200 with `eventId`; (b) `Active → Retired` by admin returns 200; (c) `Retired → Active` returns 400 `INVALID_TRANSITION`; (d) request from retired UUID returns 403; (e) non-admin role returns 403; uses `mongodb-memory-server` and JWT test helper — must FAIL before T022 **Done in `app/openad-api/src/test/integration/device-state-transition.integration.spec.ts`** (invalid transition covered as `Pending → Suspended` → `INVALID_TRANSITION` because admin DTO only allows `Suspended`/`Active`/`Retired` and retired devices are blocked by `RetiredDeviceGuard` before FSM)
- [X] T018 [P] [US1] Write failing integration test for `GET /api/v1/devices/{deviceId}/lifecycle-events` in `app/openad-api-e2e/src/devices/device-lifecycle-events.spec.ts` — verify events returned in descending `occurredAt` order with correct `fromState`, `toState`, `trigger` fields; pagination works — must FAIL before T023 **Done in `app/openad-api/src/test/integration/device-lifecycle-events.integration.spec.ts`**
- [X] T019 [P] [US1] Write failing unit tests for `HealthThresholdEvaluatorService` in `app/openad-api/src/modules/fleet-monitor/health-threshold-evaluator.service.spec.ts` — boundary-value tests: battery at 9% → `'Flagged'`; battery at 10% → `'Active'`; storage at 96% → `'Flagged'`; storage at 95% → `'Active'`; HDOP 5.1 → `'Flagged'`; HDOP 5.0 → `'Active'`; all healthy → returns `null`; tests must FAIL before T025
- [X] T020 [P] [US1] Write failing integration test for the heartbeat sweep in `app/openad-api/src/modules/fleet-monitor/heartbeat-monitor.service.spec.ts` — verify that after `FLAGGED_AFTER_MS` elapses without a heartbeat, `DeviceStateMachineService.transitionTo()` is called with `{toState: 'Flagged', trigger: {type:'system', detail:'heartbeat_timeout'}}`; mock `FleetStatusRepository` and `DeviceStateMachineService`; update existing spec file — must FAIL before T026

### Implementation — User Story 1

- [X] T021 [P] [US1] Create `app/openad-api/src/modules/fleet-monitor/health-threshold-evaluator.service.ts` — `@Injectable()` service; injects `ConfigService` for threshold values (`HEALTH_BATTERY_MIN_PERCENT`, `HEALTH_STORAGE_MAX_PERCENT`, `HEALTH_GPS_HDOP_MAX`); method `evaluate(metrics: HealthMetrics): DeviceLifecycleState | null` — returns `'Flagged'` if any threshold is breached, `null` if all clear; returns `'Active'` if device was `Flagged` and all clear (caller decides based on current state); used by `TelemetryIngestorService` and `HeartbeatMonitorService`
- [X] T022 [US1] Implement `PATCH /api/v1/devices/{deviceId}/state` endpoint — add route to `app/openad-api/src/modules/devices/devices.controller.ts`; validate `DeviceStateTransitionRequest` DTO (class-validator: `toState` enum, `reason` min-length 10); apply `@UseGuards(JwtAuthGuard, RetiredDeviceGuard, RolesGuard)` with `@Roles('fleet_admin', 'super_admin')`; call `DeviceStateMachineService.transitionTo(deviceId, dto.toState, {type:'admin', detail:dto.reason, actorId: req.user.userId})`; map exceptions to HTTP errors; add `@ApiOperation` + `@ApiResponse` decorators
- [X] T023 [US1] Implement `GET /api/v1/devices/{deviceId}/lifecycle-events` endpoint — add to `devices.controller.ts`; apply `@UseGuards(JwtAuthGuard, RetiredDeviceGuard, RolesGuard)` with `@Roles('fleet_admin', 'fleet_operator', 'super_admin')`; parse `page`/`limit` query params; call `DeviceLifecycleEventsRepository.findByDevice(deviceId, pagination)`; return paginated `DeviceLifecycleEventsResponse`; add Swagger docs
- [X] T024 [US1] Implement `PATCH /api/v1/devices/{deviceId}/capability-manifest` endpoint — add to `devices.controller.ts`; validate `CapabilityManifestUpdateRequest` DTO (class-validator: all number fields positive, `availableStorageGb ≤ totalStorageGb`); apply device JWT guard; call `DevicesRepository.updateOne({ deviceId }, { $set: { capabilityManifest: { ...dto, reportedAt: now } } })`; return `CapabilityManifestUpdateResponse`; add Swagger docs
- [X] T025 [US1] Update `app/openad-api/src/modules/fleet-monitor/health-threshold-evaluator.service.ts` and wire into `app/openad-api/src/modules/fleet-monitor/telemetry-ingestor.service.ts` — after ingesting a heartbeat, update `device.lastHealthMetrics`; call `HealthThresholdEvaluatorService.evaluate(metrics)`; if result is not null and device `lifecycleState` is `'Active'`, call `DeviceStateMachineService.transitionTo(deviceId, 'Flagged', {type:'system', detail:\`health_threshold:${breachedField}\`})`; if result is `null` and device is `'Flagged'`, call `transitionTo(deviceId, 'Active', {type:'system', detail:'health_metrics_recovered'})`
- [X] T026 [US1] Update `app/openad-api/src/modules/fleet-monitor/heartbeat-monitor.service.ts` — change `OFFLINE_AFTER_MS = 120_000` → `FLAGGED_AFTER_MS` sourced from `ConfigService` (default `180_000`); replace `fleetStatus.markOffline(doc.deviceId, flags)` call with `DeviceStateMachineService.transitionTo(doc.deviceId, 'Flagged', {type:'system', detail:'heartbeat_timeout'})`; emit `device_state_changed` WebSocket event via `FleetGateway` after each transition
- [X] T027 [US1] Extend `app/openad-api/src/modules/fleet-monitor/fleet-gateway.ts` — add `emitDeviceStateChanged(event: DeviceStateChangedEvent): void` method that broadcasts to the `fleet` room via `server.to('fleet').emit('device_state_changed', event)`; used by `HeartbeatMonitorService` and `DevicesController` transition endpoint
- [X] T028 [US1] Register new schemas and repositories in `app/openad-api/src/modules/devices/devices.module.ts` — add `MongooseModule.forFeature([{ name: DeviceLifecycleEvent.name, schema: DeviceLifecycleEventSchema }, { name: RetiredDeviceRegistryEntry.name, schema: RetiredDeviceRegistrySchema }])`; provide `DeviceLifecycleEventRepository`, `RetiredDeviceRegistryRepository`, `DeviceStateMachineService`, `HealthThresholdEvaluatorService`; export `DeviceStateMachineService` and `RetiredDeviceGuard`; update `fleet-monitor.module.ts` to import `DevicesModule` for FSM access

**Checkpoint**: User Story 1 fully functional — run `pnpm exec nx run openad-api:test --testPathPattern="device-state|health-threshold|heartbeat-monitor"` and the e2e suite.

---

## Phase 4: User Story 2 — Configuration Profiles and Device Groups (Priority: P2)

**Goal**: Administrators can create Configuration Profiles (exhibition rules, connectivity mode, CPM multiplier), create Device Groups, assign profiles to groups, and drag-and-drop tablets between groups via the Management App. Profile updates propagate to all assigned devices via MQTT within one sync cycle.

**Independent Test**: Create a profile with `adToContentRatio: 3` and `connectivityMode: Economy`; create a group; assign the profile; add 3 devices to the group via `PATCH /device-groups/{groupId}/members`; update the profile; verify MQTT `config/update` messages are published to all 3 device topics within 60s.

### Tests — User Story 2 (write BEFORE implementation, verify RED)

- [X] T029 [P] [US2] Write failing integration tests for `ConfigurationProfilesService` in `app/openad-api/src/modules/configuration-profiles/configuration-profiles.service.spec.ts` — covering: create with valid data → profile saved; create with duplicate name → `ConflictException`; delete non-default profile with assigned groups → groups reassigned to default, alert notification dispatched; delete default profile → `ConflictException`; update profile → MQTT `publishDeviceConfig()` called for all affected devices; uses `mongodb-memory-server` — must FAIL before T033
- [X] T030 [P] [US2] Write failing integration tests for `DeviceGroupsService` in `app/openad-api/src/modules/device-groups/device-groups.service.spec.ts` — covering: create group with valid profileId → group saved; `PATCH members` with 3 deviceIds → all devices get new `groupId`, previous group references cleared, `MqttService.publishDeviceConfig()` called per device; update group profile → config pushed to all member devices — must FAIL before T036
- [X] T031 [P] [US2] Write failing e2e tests for profile REST API in `app/openad-api-e2e/src/configuration-profiles/configuration-profiles.spec.ts` — `POST /configuration-profiles` (201 + body), `GET /configuration-profiles` (paginated), `PATCH` (200 + updated), `DELETE` non-default (204), `DELETE` default (409) — must FAIL before T034 **Done in `app/openad-api/src/test/integration/configuration-profiles-api.integration.spec.ts`** (in-process API + memory Mongo)
- [X] T032 [P] [US2] Write failing e2e tests for device groups REST API in `app/openad-api-e2e/src/device-groups/device-groups.spec.ts` — `POST /device-groups`, `GET /device-groups` (member count populated), `PATCH /device-groups/{id}/members` (devices reassigned) — must FAIL before T037 **Done in `app/openad-api/src/test/integration/device-groups-api.integration.spec.ts`**

### Implementation — User Story 2

- [X] T033 [US2] Implement `ConfigurationProfilesService` in `app/openad-api/src/modules/configuration-profiles/configuration-profiles.service.ts` — injects `ConfigurationProfilesRepository`, `DeviceGroupsRepository`, `DevicesRepository`, `MqttService`, `NotificationService`, `PinoLogger`; methods: `create(dto)`, `findAll(pagination)`, `findById(profileId)`, `update(profileId, dto)` (calls `publishDeviceConfigToGroup()` for all groups using profile), `delete(profileId)` (guards default; reassigns orphaned groups; sends admin alert); `publishDeviceConfigToGroup(groupId)` fetches all devices in group and calls `MqttService.publishDeviceConfig(deviceId, payload)` for each
- [X] T034 [US2] Add `ConfigurationProfilesController` in `app/openad-api/src/modules/configuration-profiles/configuration-profiles.controller.ts` — implement all 5 endpoints from `contracts/api.md` (`POST`, `GET /list`, `GET /:id`, `PATCH /:id`, `DELETE /:id`); apply `@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles('fleet_admin', 'super_admin')`; validate DTOs; add full Swagger documentation
- [X] T035 [P] [US2] Create `app/openad-api/src/modules/configuration-profiles/configuration-profiles.module.ts` — declare and provide `ConfigurationProfilesController`, `ConfigurationProfilesService`, `ConfigurationProfilesRepository`; `MongooseModule.forFeature([ConfigurationProfile schema])`; export `ConfigurationProfilesService`; register module in `AppModule`
- [X] T036 [US2] Implement `DeviceGroupsService` in `app/openad-api/src/modules/device-groups/device-groups.service.ts` — injects `DeviceGroupsRepository`, `DevicesRepository`, `ConfigurationProfilesRepository`, `MqttService`, `PinoLogger`; methods: `create(dto)` (validates `profileId` exists), `findAll(pagination)` (includes `memberCount`), `findById(groupId)`, `update(groupId, dto)` (if `profileId` changes, push config to all current members), `delete(groupId)` (unsets `groupId` on all member devices), `updateMembers(groupId, deviceIds)` (sets `groupId` on target devices; clears `groupId` on devices previously in group but not in new list; pushes config to all newly added devices)
- [X] T037 [US2] Add `DeviceGroupsController` in `app/openad-api/src/modules/device-groups/device-groups.controller.ts` — implement all 5 endpoints (`POST`, `GET /list`, `PATCH /:id`, `PATCH /:id/members`, `DELETE /:id`); apply auth guards and role checks; validate DTOs; add Swagger docs; return `ConfigSyncCompleteEvent` as part of member update response body and broadcast via `FleetGateway.emitConfigSyncComplete()`
- [X] T038 [P] [US2] Create `app/openad-api/src/modules/device-groups/device-groups.module.ts` — declare/provide module components; register in `AppModule`
- [X] T039 [US2] Extend `app/openad-api/src/infrastructure/mqtt/mqtt.service.ts` — add `publishDeviceConfig(deviceId: string, payload: DeviceConfigPayload): Promise<void>` method that publishes to topic `devices/${deviceId}/config` as retained QoS-1 message; structured-log with event `device.config.push`
- [X] T040 [P] [US2] Create DTO classes for configuration profiles — `app/openad-api/src/modules/configuration-profiles/dto/create-configuration-profile.dto.ts` with class-validator decorators: `@IsString()`, `@IsEnum(ConnectivityMode)`, `@IsNumber()`, `@Min()`/`@Max()` on all numeric fields; duplicate `UpdateConfigurationProfileDto` extending with all optional; similar for `CreateDeviceGroupDto` in `app/openad-api/src/modules/device-groups/dto/`
- [X] T041 [P] [US2] Create Device Group Manager feature in `app/openad-management/src/app/device-groups/device-groups.component.ts` and `device-groups.component.html` — import `DragDropModule` from `@angular/cdk/drag-drop`; render three CDK drop lists (one per group, dynamically generated); on `cdkDropListDropped`, call `DeviceGroupsService.updateMembers(newGroupId, deviceIds)`; fetch groups from `GET /device-groups`; show group name, profile name, and member count per list; add loading states and error handling
- [X] T042 [P] [US2] Create `app/openad-management/src/app/device-groups/device-groups.service.ts` — Angular `HttpClient`-backed service; methods: `getGroups(pagination)`, `getProfiles(pagination)`, `createGroup(dto)`, `updateGroupMembers(groupId, deviceIds)`; typed with interfaces from `@openad/api-contracts`
- [X] T043 [P] [US2] Add Device Groups route to `app/openad-management/src/app/app.routes.ts` — lazy-load `DeviceGroupsComponent` at path `fleet/groups`; add nav item in shared layout component; add `DeviceLifecycleStatePipe` to `app/openad-management/src/app/shared/device-lifecycle-state.pipe.ts` for display formatting

**Checkpoint**: Profile/group CRUD works end-to-end; drag-and-drop reassigns devices; MQTT config push confirmed in logs.

---

## Phase 5: User Story 3 — Tablet Capability Reporting and Intelligent Sync (Priority: P3)

**Goal**: The tablet reports a Capability Manifest at pairing completion; intelligently evicts LRU cached content before downloads when storage is low; detects engine-off via Android broadcast and suspends playback; resumes automatically on engine-on; uses byte-range HTTP for resumable downloads.

**Independent Test**: Trigger a sync on a device with `availableStorageGb = 0.1`; verify oldest cached asset is evicted before new download starts; simulate `ACTION_POWER_DISCONNECTED` broadcast; verify playback pauses within 30s; restore power; verify playback resumes.

### Tests — User Story 3 (write BEFORE implementation, verify RED)

- [X] T044 [P] [US3] Write failing unit tests for `StorageManagerService` in `app/openad-ad-client/src/app/services/storage-manager.service.spec.ts` — test LRU eviction: given cache index with 3 assets, when `ensureSpace(requiredBytes)` is called with more space than available, oldest `lastPlayedAt` asset is evicted first; `getAvailableBytes()` reflects post-eviction state; zero-space case skips download and emits `storage_full` event — must FAIL before T047
- [X] T045 [P] [US3] Write failing unit tests for `PowerStateMonitorService` in `app/openad-ad-client/src/app/services/power-state-monitor.service.spec.ts` — mock Capacitor plugin; on `engineOn: false` event → service emits `engine-off` within grace period; on `engineOn: true` → emits `engine-on`; verify grace timer is cleared if engine-on fires during grace period — must FAIL before T048 **(uses `powerStateChange` payload `{ connected: boolean }` proxying engine power)**
- [X] T046 [P] [US3] Write failing integration test for `CapabilityManifestService` in `app/openad-ad-client/src/app/services/capability-manifest.service.spec.ts` — verify after pairing complete event, service collects device info and calls `PATCH /api/v1/devices/{deviceId}/capability-manifest` with correct payload; mock `Device` and `App` Capacitor plugins — must FAIL before T049

### Implementation — User Story 3

- [X] T047 [US3] Implement `StorageManagerService` in `app/openad-ad-client/src/app/services/storage-manager.service.ts` — maintains in-memory + persisted (Capacitor Preferences) cache index of `{ assetId, sizeBytes, lastPlayedAt }`; methods: `getAvailableBytes(): Promise<number>` (queries device storage via Capacitor `Filesystem`), `ensureSpace(requiredBytes: number): Promise<void>` (LRU eviction loop until space available or cache empty — if empty, emits `storage_full` observable event), `recordPlayback(assetId: string): void` (updates `lastPlayedAt`), `registerDownload(assetId, sizeBytes)`, `removeFromCache(assetId)`; structured-log all evictions
- [X] T048 [US3] Implement `PowerStateMonitorService` in `app/openad-ad-client/src/app/services/power-state-monitor.service.ts` — registers Android `ACTION_POWER_CONNECTED` / `ACTION_POWER_DISCONNECTED` broadcasts via `PowerStatePlugin` (Capacitor bridge); on `DISCONNECTED` starts grace timer (`POWER_ENGINE_OFF_GRACE_MS` from env, default 30000ms); if timer expires without `CONNECTED`, emits `engineOff$` Observable and publishes MQTT `power-state` payload via `MqttClientService`; on `CONNECTED` during grace period: cancels timer, no-op; on `CONNECTED` post-grace: emits `engineOn$` Observable; `Slot` subscription in `AdPlaybackService` pauses/resumes playback accordingly
- [X] T049 [US3] Implement `CapabilityManifestService` in `app/openad-ad-client/src/app/services/capability-manifest.service.ts` — triggered once after successful pairing handshake via event subscription; collects `screenWidthPx`, `screenHeightPx`, `screenSizeInches` from `Device` Capacitor plugin; collects `totalStorageGb`, `availableStorageGb` from `Filesystem.stat()`; collects `osVersion` from `Device.getInfo()`; collects `appVersion` from `App.getInfo()`; calls `ApiClientService.patch('/devices/{deviceId}/capability-manifest', manifest)`; retries up to 3 times with exponential backoff on network failure
- [X] T050 [P] [US3] Create `app/openad-ad-client/src/capacitor/power-state.plugin.ts` — Capacitor plugin bridge that registers native Android broadcast receivers for `ACTION_POWER_CONNECTED` and `ACTION_POWER_DISCONNECTED`; emits typed events via `@capacitor/core` `registerPlugin` pattern; exports `PowerStatePlugin` interface with `addListener('powerStateChange', handler)` method
- [X] T051 [US3] Integrate `StorageManagerService` into the existing download/sync flow in `app/openad-ad-client/src/app/` — before initiating any media download: call `StorageManagerService.ensureSpace(asset.sizeBytes)`; if `storage_full` error, skip download and log warning; implement HTTP byte-range resumption: persist `{ assetId, downloadedBytes, totalBytes, etag }` in Capacitor Preferences; on retry, send `Range: bytes={downloadedBytes}-` header; validate ETag match; on mismatch restart from 0 and log warning
- [X] T052 [P] [US3] Register `StorageManagerService`, `PowerStateMonitorService`, and `CapabilityManifestService` as singleton providers in the tablet app root module; wire `PowerStateMonitorService.engineOff$` subscription into existing ad playback service to pause/resume; subscribe to `StorageManagerService.storageFullEvent$` to flag device via existing health reporting channel

**Checkpoint**: Storage eviction, engine-off detection, and manifest reporting all work independently on device.

---

## Phase 6: Polish and Cross-Cutting Concerns

**Purpose**: Observability, security hardening, environment configuration, migration, and documentation alignment.

- [X] T053 Add structured-logging coverage audit — verify every state transition, config push, eviction, and engine-off event is logged with a `PinoLogger` structured `event` key; add missing log calls in `DeviceStateMachineService`, `ConfigurationProfilesService`, `DeviceGroupsService`, `StorageManagerService`; structured log key naming convention: `<domain>.<entity>.<action>` (e.g., `device.state.transition`, `profile.config.push`) **(API: `profile.config.push`, `profile.deleted`, `device.group.members_update`; tablet: JSON `event` on console for storage / power)**
- [X] T054 [P] Add `HEARTBEAT_FLAGGED_THRESHOLD_MS`, `HEALTH_BATTERY_MIN_PERCENT`, `HEALTH_STORAGE_MAX_PERCENT`, `HEALTH_GPS_HDOP_MAX`, `POWER_ENGINE_OFF_VOLTAGE_V`, `POWER_ENGINE_OFF_GRACE_MS` to `app/openad-api/src/app/app.module.ts` `ConfigModule` validation schema (Joi or class-validator `@IsNumber()` guards); add corresponding entries with defaults to `app/openad-api/src/assets/.env.example` and the root `.env.example`
- [X] T055 [P] Write a data migration script `app/openad-api/src/scripts/migrate-device-status-to-lifecycle-state.ts` — reads all `devices` documents; maps `status` values to `lifecycleState` according to the migration table in `data-model.md` (`unbound→Pending`, `active→Active`, `inactive→Flagged`, `decommissioned→Retired`); for `Retired` devices: inserts their `deviceId` into `retired_device_registry`; idempotent (skip if `lifecycleState` already set); dry-run mode with `--dry-run` flag; logs progress and summary
- [X] T056 [P] Security hardening — add rate limiting via `@nestjs/throttler` to `PATCH /devices/{deviceId}/state` (max 10 transitions per device per minute) to prevent state-flip abuse; add input sanitisation validation to `reason` field (strip HTML); validate `commercialTierMultiplier` upper bound (max 10.0) server-side even if DTO validates it (defense-in-depth)
- [X] T057 [P] Update Swagger documentation in `app/openad-api/src/main.ts` — bump API version comment to reflect new endpoints; add tags `device-state-machine`, `configuration-profiles`, `device-groups` to `DocumentBuilder`; ensure all new controller methods have `@ApiTags` decorators
- [X] T058 Run full validation as per `quickstart.md` — start docker, run `pnpm api:serve`, confirm all new endpoints appear in Swagger UI at `http://localhost:3000/api/docs`; run `pnpm api:test` (all green); run `pnpm exec nx run openad-management:serve` and manually verify drag-and-drop group UI renders and persists; run `pnpm exec nx run openad-management-e2e:e2e` for e2e green; document any regressions found **(automated: `pnpm api:test` green; `nx run openad-api:build`, `nx run openad-ad-client:build` green; Docker/Swagger UI/management e2e left for local manual pass)**

---

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — begin immediately; T001–T008 are all parallelisable within this phase
- **Phase 2 (Foundational)**: Depends on Phase 1 completion; T009–T016 can run in parallel after Phase 1
- **Phases 3, 4, 5 (User Stories)**: All depend on Phase 2 completion; can run in parallel across teams (different apps/modules)
- **Phase 6 (Polish)**: Depends on all desired user story phases being complete before T058 (validation)

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2 — no dependency on US2 or US3
- **US2 (P2)**: Starts after Phase 2 — no dependency on US1 or US3 (independently testable with its own devices)
- **US3 (P3)**: Starts after Phase 2 — operates in `openad-ad-client` app; no dependency on US1 or US2 API changes (calls existing pairing endpoint for manifest endpoint, which is in US1 scope; US3 should be sequenced after T024 completes)

### Within Each Phase

- Tests MUST be written and verified FAILING (Red) before their paired implementation tasks
- Schemas → Repositories → Services → Controllers
- Service tests before service implementation
- Controller implementation after service is green
- MQTT integration after service logic is stable

---

## Parallel Execution Examples

### Phase 1 Parallel Launch

```
Immediately parallelisable:
  T001 — extend domain types (entities.ts)
  T002 — extend API contract types (types.ts)
  T003 — extend MQTT contract types
  T004 — create device lifecycle event schema
  T005 — create retired device registry schema
  T006 — create configuration profile schema
  T007 — create device group schema
  T008 — update devices schema (sequential only if conflicts with T001)
```

### Phase 3 (US1) Parallel Launch

```
Tests (all parallel — different test files):
  T017 — state transition e2e test
  T018 — lifecycle events e2e test
  T019 — health threshold unit test
  T020 — heartbeat monitor update test

After Phase 2 complete, parallel implementations:
  T021 — HealthThresholdEvaluatorService
  T022+T023 — controller endpoints (after T009/T010)
  T028 — module wiring
```

### Phase 4 (US2) Parallel Launch

```
Tests (all parallel):
  T029 — profiles service test
  T030 — groups service test
  T031 — profiles e2e test
  T032 — groups e2e test

Implementations in parallel:
  T033 — ConfigurationProfilesService
  T036 — DeviceGroupsService
  T039 — MqttService.publishDeviceConfig()
  T040 — DTOs
  T041+T042+T043 — Management App UI (separate app)
```

### Phase 5 (US3) Parallel Launch

```
Tests (all parallel — inside openad-ad-client):
  T044 — StorageManagerService test
  T045 — PowerStateMonitorService test
  T046 — CapabilityManifestService test

Implementations in parallel:
  T047 — StorageManagerService
  T048 — PowerStateMonitorService
  T049 — CapabilityManifestService
  T050 — PowerStatePlugin bridge
```

---

## Implementation Strategy

### MVP First — User Story 1 Only

1. Complete **Phase 1** (Setup — T001–T008)
2. Complete **Phase 2** (Foundational — T009–T016)
3. Complete **Phase 3** (US1 — T017–T028)
4. **STOP AND VALIDATE**: Run `pnpm api:test` + e2e suite; confirm state transitions, audit log, and blacklist all work
5. Deploy/demo the operational state machine independently

### Incremental Delivery

1. Setup + Foundational → types and schemas ready
2. US1 → State machine live, admin controls operational → **Demo 1**
3. US2 → Groups, profiles, Management App drag-and-drop → **Demo 2**
4. US3 → Self-aware tablet, engine-off, LRU eviction → **Demo 3**
5. Polish → All thresholds configurable, migration complete → **Production Ready**

### Parallel Team Strategy

With three developers after Phase 2:
- **Dev A**: Phase 3 (US1 — API state machine)
- **Dev B**: Phase 4 (US2 — profiles, groups, Management App)
- **Dev C**: Phase 5 (US3 — tablet app services)

---

## Notes

- `[P]` tasks operate on different files and have no blocking in-progress dependencies
- Constitution Principle VI (TDD) is non-negotiable: every `*.service.ts` must have a `*.service.spec.ts` with failing tests written first
- Commit after each task or checkpoint using Conventional Commits: `feat(devices): add DeviceStateMachineService`
- Stop at any phase checkpoint to demo or deploy independently
- The `DeviceStatus` → `DeviceLifecycleState` migration (T055) is safe to run online; the `lifecycleState` field is added without removing `status` until migration completes
- The `SPECIFY_FEATURE=002-device-state-machine` env var bypasses git branch detection if needed for scripts
