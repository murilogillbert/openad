# Tasks: End-to-End Media Orchestration Platform for Transit Advertising — System Foundation

**Input**: Design documents from `/specs/001-transit-ad-platform-foundation/`  
**Branch**: `001-transit-ad-platform-foundation`  
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/rest-api.md ✅ | contracts/mqtt-topics.md ✅

**Tests**: Included per Constitution Principle VI (TDD — NON-NEGOTIABLE). Tests MUST be written first and confirmed FAILING before implementation begins.

**Organization**: Tasks grouped by user story for independent implementation, testing, and delivery.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies at that moment)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- **TDD**: Test tasks MUST precede their implementation tasks within each story

---

## Phase 1: Setup (Workspace & Infrastructure Scaffolding)

**Purpose**: Initialize the Nx monorepo, provision all infrastructure services, and wire up shared configuration. Nothing else can start until this phase is complete.

- [X] T001 Initialize Nx monorepo workspace at repo root: `nx init` with TypeScript preset, create `apps/` and `libs/` directories per `quickstart.md` structure
- [X] T002 Scaffold NestJS API application: `nx g @nx/nest:application api` → output at `apps/api/`
- [X] T003 Scaffold Angular portal application: `nx g @nx/angular:application portal` with Angular 17 → output at `apps/portal/`
- [X] T004 [P] Generate shared domain library: `nx g @nx/js:library domain` → output at `libs/domain/`; export all entity TypeScript interfaces per `data-model.md`
- [X] T005 [P] Generate MQTT contracts library: `nx g @nx/js:library mqtt-contracts` → output at `libs/mqtt-contracts/`; define Zod schemas for all 5 topics in `contracts/mqtt-topics.md`
- [X] T006 [P] Generate API contracts library: `nx g @nx/js:library api-contracts` → output at `libs/api-contracts/`; export request/response TypeScript types for all endpoints in `contracts/rest-api.md`
- [X] T007 Configure Docker Compose at repo root `docker-compose.yml` with services: EMQX 5.x (ports 1883, 8883 TLS, 18083 dashboard), MongoDB 7.x (port 27017), Redis 7.x (port 6379)
- [X] T008 [P] Configure ESLint + Prettier for all apps and libs; add Nx lint targets; enforce no unused vars, strict TypeScript — `.eslintrc.json`, `prettier.config.js` at repo root
- [X] T009 [P] Configure environment variable management: create `.env.example` at repo root with all required keys (MONGO_URI, REDIS_URL, MQTT_URL, JWT_SECRET, JWT_REFRESH_SECRET, ASSET_STORAGE_PATH)
- [X] T010 Configure CI pipeline skeleton: `nx affected --target=test`, `nx affected --target=lint`, `nx affected --target=build` — `.github/workflows/ci.yml` or equivalent
- [X] T011 Install and configure Tailwind CSS 3.x in `apps/portal/`: `tailwind.config.js`, `postcss.config.js`; configure PrimeNG 17 with PrimeTailwind preset in `apps/portal/src/styles.scss`

**Checkpoint**: `docker-compose up` starts all 3 services. `nx run-many --target=lint` passes with zero violations.

---

## Phase 2: Foundational (Blocking Prerequisites for All User Stories)

**Purpose**: Core infrastructure that MUST be complete before any user story implementation begins. Includes database connection, MQTT broker wiring, Redis adapter, auth framework, and shared base classes.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T012 Implement MongoDB connection module in `apps/api/src/infrastructure/mongodb/mongodb.module.ts`; inject `MongooseModule.forRootAsync` with env-driven URI; add Mongoose health indicator
- [X] T013 [P] Implement Redis connection module in `apps/api/src/infrastructure/redis/redis.module.ts`; expose `RedisService` wrapping `ioredis`; support Streams (`XADD`, `XREADGROUP`, `XACK`), pub/sub, and KV `get`/`set`/`del`
- [X] T014 [P] Implement MQTT broker connection module in `apps/api/src/infrastructure/mqtt/mqtt.module.ts`; connect to EMQX via `mqtt.js` with TLS client certificate; expose `MqttService` with `publish(topic, payload, qos)` and `subscribe(topicPattern, handler)`
- [X] T015 Implement JWT authentication module in `apps/api/src/modules/auth/auth.module.ts`: `POST /api/v1/auth/login` (returns access + refresh tokens), `POST /api/v1/auth/refresh`; `JwtAuthGuard`, `RolesGuard`, `@Roles()` decorator — roles: `fleet_operator | campaign_manager | fleet_admin | finance_analyst | super_admin`
- [X] T016 [P] Write unit tests for `AuthService` in `apps/api/src/modules/auth/auth.service.spec.ts` — test login happy path, wrong password, refresh token rotation, expired token rejection **[WRITE FIRST — MUST FAIL]**
- [X] T017 [P] Write unit tests for `JwtAuthGuard` and `RolesGuard` in `apps/api/src/modules/auth/guards/` **[WRITE FIRST — MUST FAIL]**
- [X] T018 Implement base `AbstractRepository<T>` class in `apps/api/src/infrastructure/mongodb/abstract.repository.ts`; expose `create`, `findOne`, `findMany`, `updateOne`, `upsert`, `deleteOne` with typed generics; inject `Model<T>` via DI
- [X] T019 [P] Implement structured logging with Pino in `apps/api/src/infrastructure/logging/logger.module.ts`; bind request-scoped correlation ID; expose `LoggerService` wrapping `nestjs-pino`
- [X] T020 [P] Implement global HTTP exception filter in `apps/api/src/infrastructure/http/http-exception.filter.ts`; standardize error response envelope `{ error: { code, message, details } }` for all 4xx/5xx errors
- [X] T021 [P] Implement BullMQ job queue module in `apps/api/src/infrastructure/queues/queues.module.ts`; configure `BullModule.registerQueue` for `report-generation` and `asset-propagation` queues backed by Redis
- [X] T022 Configure Angular router with lazy-loaded feature modules in `apps/portal/src/app/app-routing.module.ts`: `/inventory`, `/campaigns`, `/geo-zones`, `/dashboard`, `/reports` — all guarded by `AuthGuard`
- [X] T023 [P] Implement Angular auth module in `apps/portal/src/app/auth/`: login page (PrimeNG `p-inputText`, `p-password`, `p-button`), `AuthService` (calls `POST /api/v1/auth/login`), `JwtInterceptor` (attaches Bearer token), `AuthGuard`
- [X] T024 [P] Implement Angular shared layout in `apps/portal/src/app/shared/layout/`: top `p-menubar` with nav links, sidebar `p-panelMenu`, responsive grid using Tailwind `grid`/`flex` utilities

**Checkpoint**: `POST /api/v1/auth/login` returns tokens. Angular portal loads with auth guard. All unit tests (T016, T017) pass green after implementation.

---

## Phase 3: User Story 1 — Fleet Operator: Device Onboarding & Inventory Activation (Priority: P1) 🎯 MVP

**Goal**: Fleet operators can register tablets, bind them to vehicles, and search an active inventory catalog. A single operator can onboard the entire fleet with no other system components required.

**Independent Test**: Register a new tablet via `POST /api/v1/devices/bind`, confirm the binding, then `GET /api/v1/vehicles?status=active` and see the vehicle. Attempt a duplicate bind and receive a 409. Decommission the vehicle via `DELETE /api/v1/vehicles/{id}` and confirm it disappears from the active catalog.

### Tests for User Story 1 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTATION

- [X] T025 [P] [US1] Write contract test for `POST /api/v1/devices/bind` in `app/openad-api/src/test/contract/devices-bind.contract.spec.ts`: assert 201 with `deviceId`, `mqttClientId`, `certificateThumbprint`; assert 409 on duplicate serial; assert 404 on unknown vehicleId **[WRITE FIRST — MUST FAIL]**
- [X] T026 [P] [US1] Write contract test for `GET /api/v1/vehicles` in `app/openad-api/src/test/contract/vehicles-list.contract.spec.ts`: assert paginated response, filtering by `status`, `zoneId`, `make` **[WRITE FIRST — MUST FAIL]**
- [X] T027 [P] [US1] Write contract test for `DELETE /api/v1/vehicles/{vehicleId}` in `app/openad-api/src/test/contract/vehicles-decommission.contract.spec.ts`: assert 200 with `affectedCampaigns` list; assert decommissioned vehicle excluded from `GET /api/v1/vehicles?status=active` **[WRITE FIRST — MUST FAIL]**
- [X] T028 [P] [US1] Write integration test for device onboarding full flow in `app/openad-api/src/test/integration/device-onboarding.integration.spec.ts`: bind → vehicle appears active → duplicate rejected → decommission → vehicle excluded **[WRITE FIRST — MUST FAIL]**
- [X] T029 [P] [US1] Write unit tests for `DeviceBindingService` in `app/openad-api/src/modules/devices/device-binding.service.spec.ts`: mock `DevicesRepository`, `VehiclesRepository`; test binding, conflict detection, identity generation **[WRITE FIRST — MUST FAIL]**
- [X] T030 [P] [US1] Write Playwright E2E test for device onboarding user journey in `app/openad-management-e2e/src/inventory-onboarding.e2e.spec.ts`: login-gated inventory heading + unauthenticated redirect (full bind table flow optional via `E2E_MANAGEMENT_EMAIL` / `E2E_MANAGEMENT_PASSWORD`) **[WRITE FIRST — MUST FAIL]**

### Implementation for User Story 1

- [X] T031 [P] [US1] Create Mongoose schema + `DevicesRepository` in `app/openad-api/src/modules/devices/`: schema at `devices.schema.ts`, repository at `devices.repository.ts` extending `AbstractRepository`; indexes per `data-model.md` (`deviceId` unique, `serialNumber` unique, `status+boundVehicleId`, `lastSeenAt`)
- [X] T032 [P] [US1] Create Mongoose schema + `VehiclesRepository` in `app/openad-api/src/modules/vehicles/`: schema at `vehicles.schema.ts`, repository at `vehicles.repository.ts`; indexes: `vehicleId` unique, `registrationPlate` unique, `boundDeviceId` unique (enforces 1:1 binding), `status+assignedZoneId`
- [X] T033 [US1] Implement `DeviceBindingService` in `app/openad-api/src/modules/devices/device-binding.service.ts`: `bind(dto)` — generate UUID `deviceId`, issue managed identity, write Device + update Vehicle `boundDeviceId`, reject duplicate with `ConflictException`; inject `DevicesRepository`, `VehiclesRepository`
- [X] T034 [US1] Implement `DeviceUnbindService` in `app/openad-api/src/modules/devices/device-unbind.service.ts`: `unbind(deviceId)` — set device `status: inactive`, null `boundVehicleId` on vehicle; emit `device.unbound` event for downstream consumers
- [X] T035 [US1] Implement `VehicleDecommissionService` in `app/openad-api/src/modules/vehicles/vehicle-decommission.service.ts`: `decommission(vehicleId)` — set vehicle `status: decommissioned`, null `boundDeviceId`, collect `affectedCampaignIds` from `schedule_rules` collection (status: active matching this vehicle's zone), emit `vehicle.decommissioned` event
- [X] T036 [US1] Implement `VehiclesQueryService` in `app/openad-api/src/modules/vehicles/vehicles-query.service.ts`: `findAll(filters)` — support `status`, `zoneId`, `make`, `model` filters with pagination; join latest `fleet_status` for `lastSeenAt` of bound device
- [X] T037 [US1] Implement REST controllers in `app/openad-api/src/modules/devices/devices.controller.ts` and `app/openad-api/src/modules/vehicles/vehicles.controller.ts`: wire `POST /api/v1/devices/bind`, `DELETE /api/v1/devices/{deviceId}/bind`, `GET /api/v1/vehicles`, `DELETE /api/v1/vehicles/{vehicleId}`; apply `@Roles()` guards per contract
- [X] T038 [P] [US1] Implement Angular Inventory module in `app/openad-management/src/app/inventory/`: `InventoryListComponent` with PrimeNG `p-table` (filters, status query + client search), `DeviceBindDialogComponent` with PrimeNG `p-dialog` + form fields per `DeviceBindRequest`, `InventoryService` calling REST endpoints (aligned with `desktop_fleet_listing` / `mobile_fleet_listing` designs)
- [X] T039 [P] [US1] Implement Angular vehicle detail panel in `app/openad-management/src/app/inventory/vehicle-detail/vehicle-detail.component.ts`: show device binding info, decommission flow with `ConfirmationService` + `p-confirmDialog` host on inventory page
- [X] T040 [US1] Add structured logging (Pino) to all Device and Vehicle service operations: log binding attempts, conflicts, decommissions with correlation ID and operator identity

**Checkpoint**: US1 independently testable. All T025–T030 tests pass green. Fleet operator can onboard a vehicle end-to-end in the portal.

---

## Phase 4: User Story 2 — Campaign Manager: Contextual Content Scheduling (Priority: P2)

**Goal**: Campaign managers can define campaigns with geo-zones, time windows, and creative assets. Vehicles pre-download assets and play them automatically when entering a zone during the window — including offline.

**Independent Test**: Create a campaign, upload and verify an asset, define a geo-zone, create a schedule rule, activate the campaign. Simulate a device location inside the zone during the window via a test MQTT telemetry publish. Assert the device's active schedule (Redis cache or MQTT schedule topic) contains the correct rule and asset.

### Tests for User Story 2 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTATION

- [X] T041 [P] [US2] Write contract tests for `POST /api/v1/campaigns`, `POST /api/v1/campaigns/{id}/assets`, `POST /api/v1/campaigns/{id}/rules`, `PATCH /api/v1/campaigns/{id}/status` in `app/openad-api/src/test/contract/campaigns.contract.spec.ts` **[WRITE FIRST — MUST FAIL]**
- [X] T042 [P] [US2] Write contract tests for `POST /api/v1/geo-zones`, `GET /api/v1/geo-zones` in `app/openad-api/src/test/contract/geo-zones.contract.spec.ts` **[WRITE FIRST — MUST FAIL]**
- [X] T043 [P] [US2] Write MQTT contract test for `schedule` topic in `app/openad-api/src/test/contract/mqtt-schedule.contract.spec.ts`: assert schema matches `contracts/mqtt-topics.md`, `rules[]` array with `assetChecksumSha256`, nested `geoZones`, `timeWindows` **[WRITE FIRST — MUST FAIL]**
- [X] T044 [P] [US2] Write unit tests for `GeoScheduleEvaluatorService` in `app/openad-api/src/modules/schedule-rules/geo-schedule-evaluator.service.spec.ts`: test geo-zone intersection true/false, time window active/inactive, priority conflict resolution, dwell threshold **[WRITE FIRST — MUST FAIL]**
- [X] T045 [P] [US2] Write unit tests for `AssetIntegrityService` in `app/openad-api/src/modules/campaigns/asset-integrity.service.spec.ts`: test SHA-256 verification pass/fail, status transitions `pending → verified → deprecated` **[WRITE FIRST — MUST FAIL]**
- [X] T046 [P] [US2] Write integration test for full campaign scheduling flow in `app/openad-api/src/test/integration/campaign-scheduling.integration.spec.ts`: create campaign → upload asset → verify asset → create geo-zone → create rule → activate → assert schedule published to MQTT for target device **[WRITE FIRST — MUST FAIL]**
- [X] T047 [P] [US2] Write Playwright E2E test for campaign builder in `app/openad-management-e2e/src/campaign-builder.e2e.spec.ts`: login-gated campaigns heading + optional full flow via `E2E_MANAGEMENT_*` **[WRITE FIRST — MUST FAIL]**

### Implementation for User Story 2

- [X] T048 [P] [US2] Create Mongoose schemas + repositories for `campaigns`, `creative_assets`, `geo_zones`, `schedule_rules` in `app/openad-api/src/modules/campaigns/` and `app/openad-api/src/modules/geo-zones/`; apply all indexes from `data-model.md` including `{ geometry: "2dsphere" }` on `geo_zones`
- [X] T049 [P] [US2] Implement `AssetUploadService` in `app/openad-api/src/modules/campaigns/asset-upload.service.ts`: accept multipart file, compute SHA-256, store to filesystem/object store at `ASSET_STORAGE_PATH`, write `CreativeAsset` document with `status: pending`, enqueue integrity verification job on `asset-propagation` BullMQ queue
- [X] T050 [P] [US2] Implement `AssetIntegrityWorker` (BullMQ processor) in `app/openad-api/src/modules/campaigns/asset-integrity.worker.ts`: re-read file from storage, recompute SHA-256, compare to stored `checksumSha256`, transition asset to `verified` or `rejected`; reject schedule rule creation if asset not `verified`
- [X] T051 [US2] Implement `CampaignLifecycleService` in `app/openad-api/src/modules/campaigns/campaign-lifecycle.service.ts`: `create`, `activate`, `pause`, `complete`; on `activate` → validate all rules have `verified` assets → transition to `active` → emit `campaign.activated` event
- [X] T052 [US2] Implement `GeoZoneService` in `app/openad-api/src/modules/geo-zones/geo-zone.service.ts`: `create(dto)` — validate GeoJSON polygon ring closure, insert with 2dsphere index; `findAll(filters)` with city/tag filters and pagination
- [X] T053 [US2] Implement `ScheduleRuleService` in `app/openad-api/src/modules/schedule-rules/schedule-rule.service.ts`: `create(dto)` — validate asset is `verified`, validate geoZoneIds exist, validate time windows non-overlapping within same priority; `GeoScheduleEvaluatorService.evaluate(location, dt)` → returns matching rules sorted by priority
- [X] T054 [US2] Implement `SchedulePushService` in `app/openad-api/src/modules/schedule-rules/schedule-push.service.ts`: on campaign activate / rule update / asset update → query target devices (vehicles whose `assignedZoneId` overlaps any rule's `geoZoneIds`) → build schedule payload per `contracts/mqtt-topics.md` → publish to `openad/{deviceId}/schedule` QoS 1 retained via `MqttService` → cache in `Redis cache:schedule:{deviceId}` with 5m TTL
- [X] T055 [US2] Implement REST controllers: `CampaignsController` at `app/openad-api/src/modules/campaigns/campaigns.controller.ts` (CRUD + asset upload + status patch), `GeoZonesController` at `app/openad-api/src/modules/geo-zones/geo-zones.controller.ts`; apply `@Roles()` guards per contract
- [X] T056 [P] [US2] Implement Angular Campaigns module in `app/openad-management/src/app/campaigns/`: `CampaignListComponent` (PrimeNG `p-table`), `CampaignWizardComponent` (multi-step flow: details, asset upload via `p-fileUpload`, rule builder)
- [X] T057 [P] [US2] Implement Angular Geo-Zone draw UI in `app/openad-management/src/app/geo-zones/geo-zone-map.component.ts`: Leaflet map for polygon vertices + emit GeoJSON coordinates; geo-zones page saves via API
- [X] T058 [US2] Add structured logging to all Campaign, GeoZone, and SchedulePush service operations: log campaign state transitions, asset verification outcomes, schedule push targets with device count

**Checkpoint**: US2 independently testable. All T041–T047 tests pass green. A campaign manager can build a complete campaign and the system pushes the schedule to targeted devices.

---

## Phase 5: User Story 3 — Fleet Administrator: Real-Time Fleet Health Monitoring & Remote Management (Priority: P3)

**Goal**: Fleet administrators see a live map of all vehicles with health status refreshed every ≤30s. They can detect offline devices, receive alerts within 2 minutes, and issue remote commands that are queued for offline devices and executed on reconnect.

**Independent Test**: Start a simulated device publishing telemetry at 30s intervals. Stop it. Within 2 minutes assert the device appears as `offline/alert` via `GET /api/v1/fleet/status`. Issue a `RESTART` command via `POST /api/v1/fleet/devices/{id}/commands`. Restart the simulated device and assert the command is acknowledged and `GET /api/v1/fleet/devices/{id}/commands` shows `status: acknowledged`.

### Tests for User Story 3 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTATION

- [X] T059 [P] [US3] Write MQTT contract tests for `openad/{deviceId}/telemetry` and `openad/{deviceId}/commands/ack` topic schemas in `app/openad-api/src/test/contract/mqtt-telemetry.contract.spec.ts` **[WRITE FIRST — MUST FAIL]**
- [X] T060 [P] [US3] Write MQTT contract test for `openad/{deviceId}/commands` server→device topic schema in `app/openad-api/src/test/contract/mqtt-commands.contract.spec.ts` **[WRITE FIRST — MUST FAIL]**
- [X] T061 [P] [US3] Write unit tests for `HeartbeatMonitorService` in `apps/api/src/modules/fleet-monitor/heartbeat-monitor.service.spec.ts`: test offline threshold detection, alert flag setting, notification trigger timing **[WRITE FIRST — MUST FAIL]**
- [X] T062 [P] [US3] Write unit tests for `RemoteCommandService` in `apps/api/src/modules/fleet-monitor/remote-command.service.spec.ts`: test command enqueue, MQTT publish, ACK processing, queued-on-offline behaviour **[WRITE FIRST — MUST FAIL]**
- [X] T063 [P] [US3] Write contract tests for `GET /api/v1/fleet/status`, `POST /api/v1/fleet/devices/{id}/commands`, `GET /api/v1/fleet/devices/{id}/commands` in `app/openad-api/src/test/contract/fleet-monitor.contract.spec.ts` **[WRITE FIRST — MUST FAIL]**
- [X] T064 [P] [US3] Write integration test for command lifecycle in `app/openad-api/src/test/integration/remote-command-lifecycle.integration.spec.ts`: issue command → verify `queued` → simulate device ACK via MQTT → verify `acknowledged` in MongoDB + dashboard notification via Redis pub/sub **[WRITE FIRST — MUST FAIL]**
- [X] T065 [P] [US3] Write Playwright E2E test for Mission Control dashboard in `app/openad-management-e2e/src/fleet-dashboard.e2e.spec.ts`: open dashboard → verify vehicles on map with status indicators → click offline vehicle → issue RESTART → verify command status updates **[WRITE FIRST — MUST FAIL]**

### Implementation for User Story 3

- [X] T066 [P] [US3] Create Mongoose schema + `FleetStatusRepository` in `apps/api/src/modules/fleet-monitor/fleet-status.repository.ts`: upsert-only on `deviceId`; indexes: `deviceId` unique, `connectivity.status + reportedAt`, `location 2dsphere`
- [X] T067 [P] [US3] Create Mongoose schema + `RemoteCommandsRepository` in `apps/api/src/modules/fleet-monitor/remote-commands.repository.ts`: indexes `commandId` unique, `deviceId + status + issuedAt`, TTL on `expiresAt`
- [X] T068 [US3] Implement `TelemetryIngestorService` in `apps/api/src/modules/fleet-monitor/telemetry-ingestor.service.ts`: subscribe to `openad/+/telemetry` via `MqttService` (QoS 0); on each message → push to `Redis stream:telemetry` via `XADD`; telemetry worker (BullMQ or `XREADGROUP`) upserts `fleet_status` in MongoDB; updates `Redis cache:fleet:{deviceId}` with 35s TTL
- [X] T069 [US3] Implement `HeartbeatMonitorService` in `apps/api/src/modules/fleet-monitor/heartbeat-monitor.service.ts`: scheduled job every 30s (`@Cron`) — sweep `Redis set:offline_devices` + check `cache:fleet:{deviceId}` TTL expiry; transition `connectivity.status → offline`; publish alert to `Redis pubsub:dashboard`; emit `NotificationService.alertAdmins(deviceId)` within 2 minutes of first missed heartbeat (SC-004)
- [X] T070 [P] [US3] Implement `NotificationService` in `apps/api/src/modules/fleet-monitor/notification.service.ts`: in-app notification record write to MongoDB `notifications` collection; extend to email via SMTP in Phase N Polish; emit notification via `Redis pubsub:dashboard` for real-time portal display
- [X] T071 [US3] Implement `RemoteCommandService` in `apps/api/src/modules/fleet-monitor/remote-command.service.ts`: `issue(deviceId, type, payload)` → write to `remote_commands` (status: queued) → publish to `Redis stream:commands` → command dispatcher worker reads stream → publishes to `openad/{deviceId}/commands` QoS 1 → if device unreachable, command stays `queued` until ACK
- [X] T072 [US3] Implement `CommandAckHandler` in `apps/api/src/modules/fleet-monitor/command-ack.handler.ts`: subscribe to `openad/+/commands/ack` (QoS 1); update `remote_commands.status → acknowledged`; store `deviceResponse`; publish status change to `Redis pubsub:dashboard`
- [X] T073 [US3] Implement `FleetMonitorController` in `apps/api/src/modules/fleet-monitor/fleet-monitor.controller.ts`: `GET /api/v1/fleet/status` (reads from Redis `cache:fleet:*` or MongoDB), `POST /api/v1/fleet/devices/{id}/commands`, `GET /api/v1/fleet/devices/{id}/commands`; apply `@Roles(fleet_admin)` guard
- [X] T074 [US3] Implement WebSocket gateway in `apps/api/src/modules/fleet-monitor/fleet-gateway.ts` using Socket.io (`@WebSocketGateway`): subscribe to `Redis pubsub:dashboard`; broadcast fleet status updates and alert events to all connected portal clients; authenticate via JWT on handshake
- [X] T075 [P] [US3] Implement Angular Mission Control Dashboard module in `app/openad-management/src/app/dashboard/`: `DashboardMapComponent` using Leaflet (or PrimeNG `p-gmap`) rendering all vehicles as colored markers (green=online, amber=degraded, red=offline); subscribe to Socket.io for live updates; refresh markers ≤30s
- [X] T076 [P] [US3] Implement Angular vehicle command panel in `app/openad-management/src/app/dashboard/command-panel.component.ts`: list remote commands with status badges (PrimeNG `p-tag`), issue command form (PrimeNG `p-select` for type, `p-button` to submit), real-time status update via Socket.io
- [X] T077 [US3] Add structured logging to all fleet monitor operations: log telemetry ingestion rate, heartbeat sweeps, offline transitions, command issue/acknowledgement with operator identity and device ID

**Checkpoint**: US3 independently testable. All T059–T065 tests pass green. Administrator can monitor fleet live and issue remote commands from the Mission Control dashboard.

---

## Phase 6: User Story 4 — Finance / Analytics: Proof-of-Play Reporting & Commercial Accountability (Priority: P4)

**Goal**: Every ad play generates an immutable impression event. Finance analysts can generate Proof-of-Play reports within 5 minutes, view drill-down detail for dispute resolution, and export billing summaries by campaign and operator.

**Independent Test**: Publish 100 simulated impression events via MQTT QoS 2. Assert all 100 are in MongoDB `impression_events` with no duplicates. Request a Proof-of-Play report via `POST /api/v1/reports/proof-of-play`. Poll `GET /api/v1/reports/{jobId}` until `status: ready` (≤5 min). Assert the report's `totalImpressions = 100` and `downloadUrl` is accessible.

### Tests for User Story 4 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTATION

- [X] T078 [P] [US4] Write MQTT contract test for `openad/{deviceId}/impressions` (QoS 2) topic schema in `apps/api/test/contract/mqtt-impressions.contract.spec.ts`: assert `eventId`, `ts`, `campaignId`, `location.gpsLocked` fields **[WRITE FIRST — MUST FAIL]**
- [X] T079 [P] [US4] Write unit tests for `ImpressionIngestionService` in `apps/api/src/modules/impressions/impression-ingestion.service.spec.ts`: test dedup by `eventId`, `locationVerified` flag setting when `gpsLocked: false`, `billingValue` snapshot from campaign rate **[WRITE FIRST — MUST FAIL]**
- [X] T080 [P] [US4] Write unit tests for `ReportGenerationWorker` in `apps/api/src/modules/reporting/workers/report-generation.worker.spec.ts`: test MongoDB aggregation pipeline outputs correct `totalImpressions`, `uniqueZonesReached`, `totalBillableValue` **[WRITE FIRST — MUST FAIL]**
- [X] T081 [P] [US4] Write contract tests for `POST /api/v1/reports/proof-of-play`, `GET /api/v1/reports/{jobId}`, `GET /api/v1/reports/impressions/{eventId}`, `GET /api/v1/reports/billing` in `apps/api/test/contract/reporting.contract.spec.ts` **[WRITE FIRST — MUST FAIL]**
- [X] T082 [P] [US4] Write integration test for end-to-end impression pipeline in `apps/api/test/integration/impression-pipeline.integration.spec.ts`: publish MQTT impression (QoS 2) → assert Redis stream entry → assert MongoDB document written → assert eventId dedup blocks re-delivery **[WRITE FIRST — MUST FAIL]**
- [X] T083 [P] [US4] Write integration test for Proof-of-Play report generation in `apps/api/test/integration/proof-of-play-report.integration.spec.ts`: seed 100 impression events → request report → poll until ready → assert summary totals correct **[WRITE FIRST — MUST FAIL]**
- [X] T084 [P] [US4] Write Playwright E2E test for reporting module in `apps/portal/e2e/proof-of-play-report.e2e.spec.ts`: navigate to Reports → select campaign → request PDF report → verify download link appears **[WRITE FIRST — MUST FAIL]**

### Implementation for User Story 4

- [X] T085 [P] [US4] Create Mongoose schema + `ImpressionEventsRepository` in `apps/api/src/modules/impressions/impression-events.repository.ts`: append-only (no `updateOne`/`deleteOne`); indexes: `eventId` unique, `campaignId + playedAt`, `vehicleId + playedAt`, `location 2dsphere`, `locationVerified + campaignId`; no TTL (immutable)
- [X] T086 [US4] Implement `ImpressionIngestionService` in `apps/api/src/modules/impressions/impression-ingestion.service.ts`: subscribe to `openad/+/impressions` (QoS 2) via `MqttService`; push each message to `Redis stream:impressions` via `XADD`; worker (`XREADGROUP`) reads from stream → validates schema (Zod, from `libs/mqtt-contracts`) → deduplicates by `eventId` (unique index) → snapshots `billingValue` from campaign `ratePerImpression` → sets `locationVerified: gpsLocked` → inserts to MongoDB
- [X] T087 [P] [US4] Implement `ReportingService` in `apps/api/src/modules/reporting/reporting.service.ts`: `requestReport(campaignId, format)` → write report job to MongoDB (status: queued) → enqueue BullMQ job on `report-generation` queue; `getReport(jobId)` → return status + pre-signed `downloadUrl` when ready
- [X] T088 [US4] Implement `ReportGenerationWorker` (BullMQ processor) in `apps/api/src/modules/reporting/workers/report-generation.worker.ts`: MongoDB aggregation pipeline on `impression_events` (match `campaignId`, group by `scheduleRuleId`/`vehicleId`, compute `$sum`, `$addToSet` for zones, `$count` for impressions); format as JSON/CSV/PDF; write to storage; update report job `status: ready` + `downloadUrl`
- [X] T089 [US4] Implement `BillingReportService` in `apps/api/src/modules/reporting/billing-report.service.ts`: aggregate `impression_events` by campaign and by `vehicleId` (joined to `operatorId` via vehicles) for a given billing cycle date range; return `byCampaign[]` and `byOperator[]` arrays per contract
- [X] T090 [US4] Implement `ReportingController` in `apps/api/src/modules/reporting/reporting.controller.ts`: `POST /api/v1/reports/proof-of-play`, `GET /api/v1/reports/{jobId}`, `GET /api/v1/reports/impressions/{eventId}`, `GET /api/v1/reports/billing`; apply `@Roles(finance_analyst, fleet_admin)` guards
- [X] T091 [P] [US4] Implement Angular Reports module in `apps/portal/src/app/reports/`: `ReportListComponent` (PrimeNG `p-table` of past reports), `ReportRequestFormComponent` (campaign selector `p-dropdown`, format `p-selectButton`), `ReportStatusPollerComponent` (polls `GET /api/v1/reports/{jobId}` every 10s until ready, shows `p-progressBar`), download button when ready
- [X] T092 [P] [US4] Implement Angular Impression Drill-Down component in `apps/portal/src/app/reports/impression-detail/impression-detail.component.ts`: display full `ImpressionEvent` metadata (time, vehicle, location map pin, creative asset, `locationVerified` flag, `billingValue`) using PrimeNG `p-card` + Leaflet point marker
- [X] T093 [US4] Add structured logging to all impression ingestion operations: log per-event: `eventId`, `deviceId`, `campaignId`, `locationVerified`, `billingValue`, deduplication hits; log per-report-job: `campaignId`, `impressionCount`, `generationTimeMs`

**Checkpoint**: US4 independently testable. All T078–T084 tests pass green. Every ad play has a permanent, immutable record and finance analysts can generate exportable Proof-of-Play reports.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Harden security, complete API documentation, add missing tests, and validate the full system end-to-end against the spec's success criteria.

- [X] T094 [P] MQTT broker security hardening: configure EMQX ACL rules in `docker-compose.yml` / EMQX config so each device clientId can only publish/subscribe its own `openad/{deviceId}/*` topics; validate with integration test `apps/api/test/integration/mqtt-acl.integration.spec.ts`
- [X] T095 [P] Generate OpenAPI 3.0 spec from NestJS `@nestjs/swagger` decorators: output to `apps/api/openapi.json`; configure Swagger UI at `/api/docs`; run `nx g @nx/js:library api-contracts` sync to regenerate shared types
- [X] T096 [P] Add `@nestjs/throttler` rate limiting to all REST endpoints: login: 5/min, uploads: 10/min, report requests: 5/min — configure in `apps/api/src/app.module.ts`
- [X] T097 [P] Implement asset pre-signed URL generation for MQTT `schedule` topic: add `AssetUrlService` in `apps/api/src/modules/campaigns/asset-url.service.ts`; generate time-limited (24h) download URLs; rotate URLs 2h before expiry via BullMQ scheduled job
- [X] T098 [P] Add MongoDB indexes validation script at `apps/api/scripts/ensure-indexes.ts`: run on startup to verify all `data-model.md` indexes exist; log warning if any are missing; add to `apps/api/src/main.ts` startup sequence
- [X] T099 [P] Implement `HealthController` at `apps/api/src/health/health.controller.ts` using `@nestjs/terminus`: `GET /api/health` checks MongoDB connection, Redis ping, EMQX WebSocket reachability; returns JSON health report
- [X] T100 [P] Configure coverage reporting: enforce 80% line coverage threshold in `nx.json` Jest config for all `apps/api` modules; add coverage badge to README
- [X] T101 [P] Write additional unit tests to reach 80% coverage threshold for any module below threshold: identify gaps with `nx run api:test --coverage`, add tests in relevant `*.spec.ts` files
- [X] T102 [P] Add PrimeNG `p-toast` global notification component in `apps/portal/src/app/shared/layout/`; wire to `NotificationService` WebSocket events: show fleet alerts, command acknowledgements, report ready notifications
- [X] T103 [P] Implement Angular `GlobalErrorHandler` in `apps/portal/src/app/shared/error/global-error-handler.ts`: catch HTTP 4xx/5xx and display standardized `p-toast` error messages; log to console in development
- [X] T104 Run quickstart.md validation: execute all 4 core flows manually or via integration test suite; confirm SC-001 through SC-010 success criteria are met; document results in `specs/001-transit-ad-platform-foundation/validation-results.md`
- [X] T105 [P] Write project README at repo root `README.md`: system overview, prerequisites, `docker-compose up` steps, `nx run api:serve` + `nx run portal:serve` commands, link to `specs/001-transit-ad-platform-foundation/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1: Setup        → No dependencies. Start immediately.
Phase 2: Foundational → Depends on Phase 1 completion. BLOCKS all user stories.
Phase 3: US1 (P1)    → Depends on Phase 2. No dependency on US2/US3/US4.
Phase 4: US2 (P2)    → Depends on Phase 2. Integrates with US1 models but independently testable.
Phase 5: US3 (P3)    → Depends on Phase 2. Reads device registry from US1 but independently testable.
Phase 6: US4 (P4)    → Depends on Phase 2. References campaigns (US2) and devices (US1) via IDs but independently testable with seeded data.
Phase 7: Polish      → Depends on all desired user stories being complete.
```

### User Story Dependencies (within Phase 2+)

| Story | Foundational Dependency | Cross-Story Dependency |
|---|---|---|
| US1 (Device Onboarding) | Phase 2 complete | None — pure foundation |
| US2 (Campaign Scheduling) | Phase 2 complete | Reads `vehicles` entities from US1 for schedule push targets; can use seeded data |
| US3 (Fleet Monitor) | Phase 2 complete | Reads `devices` entities from US1 for status tracking; can use seeded data |
| US4 (Proof-of-Play) | Phase 2 complete | References `campaigns` (US2) and `devices` (US1) via IDs; can use seeded data |

### Within Each User Story

```
Test tasks (T025–T030, etc.) MUST be written FIRST and confirmed FAILING
→ Schema / Repository tasks [P] (can run in parallel)
→ Service layer tasks (depend on schemas)
→ Controller / REST endpoint tasks (depend on services)
→ Angular UI tasks [P] (can run in parallel with backend controller)
→ Logging tasks
→ Checkpoint validation
```

### Parallel Opportunities

- **Phase 1**: T004, T005, T006, T008, T009 can all run in parallel after T001–T003
- **Phase 2**: T013, T014, T016, T017, T019, T020, T021, T023, T024 can run in parallel after T012, T015
- **Phase 3–6**: All test tasks marked [P] within a story can run in parallel; all schema tasks marked [P] can run in parallel
- **Cross-story**: Once Phase 2 completes, US1 + US2 + US3 + US4 can be worked by four developers simultaneously

---

## Parallel Example: User Story 1

```bash
# Step 1: Write all tests in parallel (MUST FAIL first)
Task T025: Contract test — POST /api/v1/devices/bind
Task T026: Contract test — GET /api/v1/vehicles
Task T027: Contract test — DELETE /api/v1/vehicles/{vehicleId}
Task T028: Integration test — device onboarding flow
Task T029: Unit test — DeviceBindingService
Task T030: Playwright E2E — inventory onboarding journey

# Step 2: Implement schemas in parallel (after tests are written)
Task T031: DevicesRepository (schema + repo)
Task T032: VehiclesRepository (schema + repo)

# Step 3: Services (sequential, depend on repos)
Task T033: DeviceBindingService
Task T034: DeviceUnbindService
Task T035: VehicleDecommissionService
Task T036: VehiclesQueryService

# Step 4: Controller + Angular UI in parallel (UI doesn't depend on NestJS to be running)
Task T037: NestJS REST controllers
Task T038: Angular InventoryListComponent + DeviceBindFormComponent
Task T039: Angular VehicleDetailComponent

# Step 5: Logging + Checkpoint
Task T040: Add structured logging
→ Run tests T025–T030 → ALL MUST PASS GREEN
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3 = US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL)
3. Complete Phase 3: User Story 1 (Device Onboarding)
4. **STOP and VALIDATE**: All T025–T030 tests green. Portal inventory catalog functional.
5. Demo to stakeholders: fleet operators can onboard the full vehicle fleet.

### Incremental Delivery

1. Setup + Foundational → infrastructure ready
2. **+US1** → Fleet has a managed inventory catalog (MVP, independently deployable)
3. **+US2** → Campaigns are live and schedules push to vehicles (first revenue-generating milestone)
4. **+US3** → Mission Control operational; ops team can manage fleet remotely
5. **+US4** → Advertisers receive auditable Proof-of-Play; billing cycle enabled
6. **+Polish** → Production-hardened, documented, 80% coverage met

### Parallel Team Strategy (4 developers post-Phase 2)

| Developer | User Story | Key Deliverable |
|---|---|---|
| Dev A | US1 — Inventory Activation | Device binding API + Inventory portal |
| Dev B | US2 — Contextual Delivery | Campaign builder + MQTT schedule push |
| Dev C | US3 — Fleet Intelligence | Fleet monitor + Mission Control dashboard |
| Dev D | US4 — Proof-of-Play | Impression pipeline + Reporting module |

All developers start simultaneously after Phase 2 checkpoint is confirmed.

---

## Notes

- **[P]** tasks use different files and have no dependency on incomplete tasks in the same phase — safe to run in parallel
- **[USn]** label maps each task to its user story for traceability to `spec.md` acceptance scenarios
- Every test task **MUST be confirmed FAILING** before its implementation task begins (TDD Red step)
- Commit after each logical group (e.g., after all repositories in a story, after all services)
- Stop at each **Checkpoint** to validate the story is independently functional before proceeding
- Constitution Principle VI (TDD) is NON-NEGOTIABLE — no implementation task may be started without a preceding failing test
