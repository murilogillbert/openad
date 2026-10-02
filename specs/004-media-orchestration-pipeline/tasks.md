# Tasks: Media Orchestration & Manifest Pipeline

**Input**: Design documents from `/specs/004-media-orchestration-pipeline/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Following TDD (Principle VI), tests are written FIRST before implementation. All test tasks must FAIL before proceeding to implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is an Nx monorepo with:
- **Backend API**: `app/openad-api/src/`
- **Tablet Client**: `app/openad-ad-client/src/`
- **Shared Libraries**: `libs/api-contracts/`, `libs/mqtt-contracts/`, `libs/domain/`
- **Tests**: `app/openad-api/src/test/` (backend), `app/openad-ad-client/src/` (frontend)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Install new backend dependencies: fluent-ffmpeg, @types/fluent-ffmpeg
- [X] T002 [P] Add LocalStack (S3) and Mosquitto (MQTT) services to docker-compose.yml
- [X] T003 [P] Create Mosquitto config file at mosquitto/config/mosquitto.conf
- [X] T004 [P] Add environment variables to .env for S3, MQTT, and media validation constraints
- [X] T005 Create S3 bucket in LocalStack using AWS CLI
- [X] T006 [P] Create factory default ad videos (2-3 generic ads) in app/openad-ad-client/capacitor/assets/factory-default-ads/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure and shared contracts that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Shared Contracts (libs/)

- [X] T007 [P] Create MediaCategorization and VideoCodec enums in libs/api-contracts/src/media/media-asset.contract.ts
- [X] T008 [P] Create Geofence, TimeWindow, SpeedRange, and Constraints Zod schemas in libs/api-contracts/src/media/media-asset.contract.ts
- [X] T009 [P] Create MediaAsset Zod schema in libs/api-contracts/src/media/media-asset.contract.ts
- [X] T010 [P] Create ManifestItem and Manifest Zod schemas in libs/api-contracts/src/media/manifest.contract.ts
- [X] T011 [P] Create PriorityLevel and PriorityCommand Zod schemas in libs/mqtt-contracts/src/lib/priority-command.contract.ts
- [X] T012 [P] Create MediaAsset domain model in libs/domain/src/media/media-asset.model.ts
- [X] T013 [P] Create Manifest domain model in libs/domain/src/media/manifest.model.ts
- [X] T014 [P] Create PriorityCommand domain model in libs/domain/src/media/priority-command.model.ts
- [X] T015 [P] Create Constraint domain model in libs/domain/src/media/constraint.model.ts

### Backend Infrastructure

- [X] T016 Extend S3 config to support byte-range requests in app/openad-api/src/infrastructure/storage/s3.config.ts
- [X] T017 [P] Create test fixtures directory and generate small test videos at app/openad-api/test/fixtures/

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Admin Uploads Valid Advertisement (Priority: P1) 🎯 MVP

**Goal**: Enable administrators to upload video ads with validation, hashing, and cataloging

**Independent Test**: Upload a compliant video file through the API and verify it appears in the media catalog with a unique SHA-256 hash

### Tests for User Story 1 (TDD - Write First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T018 [P] [US1] Unit test for VideoValidatorService in app/openad-api/src/modules/media-ingestion/validators/video-validator.service.spec.ts
- [X] T019 [P] [US1] Unit test for HashGeneratorService in app/openad-api/src/modules/media-ingestion/validators/hash-generator.service.spec.ts
- [X] T020 [P] [US1] Unit test for S3StorageService in app/openad-api/src/modules/media-ingestion/storage/s3-storage.service.spec.ts
- [X] T021 [P] [US1] Integration test for media upload endpoint in app/openad-api/src/test/integration/media-ingestion.integration.spec.ts

### Implementation for User Story 1

- [X] T022 [P] [US1] Generate media-ingestion module using Nx: `nx g @nx/nest:module media-ingestion --project=openad-api --directory=modules/media-ingestion`
- [X] T023 [P] [US1] Create MediaAsset Mongoose schema in app/openad-api/src/modules/media-ingestion/schemas/media-asset.schema.ts
- [X] T024 [P] [US1] Create UploadMediaDto in app/openad-api/src/modules/media-ingestion/dto/upload-media.dto.ts
- [X] T025 [P] [US1] Create MediaValidationErrorDto in app/openad-api/src/modules/media-ingestion/dto/media-validation-error.dto.ts
- [X] T026 [US1] Implement VideoValidatorService with FFprobe integration in app/openad-api/src/modules/media-ingestion/validators/video-validator.service.ts
- [X] T027 [US1] Implement HashGeneratorService with SHA-256 streaming in app/openad-api/src/modules/media-ingestion/validators/hash-generator.service.ts
- [X] T028 [US1] Implement S3StorageService with upload and pre-signed URL generation in app/openad-api/src/modules/media-ingestion/storage/s3-storage.service.ts
- [X] T029 [US1] Implement MediaIngestionService orchestrating validation, hashing, and storage in app/openad-api/src/modules/media-ingestion/media-ingestion.service.ts
- [X] T030 [US1] Implement MediaIngestionController with POST /v1/media/upload endpoint in app/openad-api/src/modules/media-ingestion/media-ingestion.controller.ts
- [X] T031 [US1] Implement GET /v1/media endpoint for media catalog listing in app/openad-api/src/modules/media-ingestion/media-ingestion.controller.ts
- [X] T032 [US1] Implement GET /v1/media/:mediaId endpoint for media details in app/openad-api/src/modules/media-ingestion/media-ingestion.controller.ts
- [X] T033 [US1] Implement DELETE /v1/media/:mediaId endpoint for soft-delete in app/openad-api/src/modules/media-ingestion/media-ingestion.controller.ts
- [X] T034 [US1] Add error handling and logging for media ingestion operations
- [X] T035 [US1] Add rate limiting middleware to media upload endpoint (100 req/min)
- [X] T036 [US1] Register MediaIngestionModule in app module

**Checkpoint**: At this point, User Story 1 should be fully functional - admins can upload videos and see them cataloged

---

## Phase 4: User Story 2 - Tablet Receives and Synchronizes Manifest (Priority: P1)

**Goal**: Enable tablets to fetch manifests, download media files with resumable downloads, and verify file integrity

**Independent Test**: Provide a tablet with a manifest containing 3 ads, verify all 3 download successfully, then send an updated manifest with 1 new ad and 1 removed ad, and confirm the tablet adds the new file and deletes the removed one

### Tests for User Story 2 (TDD - Write First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T037 [P] [US2] Unit test for ManifestGeneratorService in app/openad-api/src/modules/manifest/generators/manifest-generator.service.spec.ts
- [X] T038 [P] [US2] Unit test for DeltaCalculatorService in app/openad-api/src/modules/manifest/generators/delta-calculator.service.spec.ts
- [X] T039 [P] [US2] Integration test for manifest endpoint in app/openad-api/src/test/integration/manifest-generation.integration.spec.ts
- [X] T040 [P] [US2] Unit test for DownloadManagerService in app/openad-ad-client/src/app/features/sync/services/download-manager.service.spec.ts
- [X] T041 [P] [US2] Unit test for HashVerifierService in app/openad-ad-client/src/app/features/sync/services/hash-verifier.service.spec.ts
- [X] T042 [P] [US2] Unit test for StorageManagerService in app/openad-ad-client/src/app/features/sync/services/storage-manager.service.spec.ts

### Backend Implementation for User Story 2

- [X] T043 [P] [US2] Generate manifest module using Nx: `nx g @nx/nest:module manifest --project=openad-api --directory=modules/manifest`
- [X] T044 [P] [US2] Create Manifest Mongoose schema in app/openad-api/src/modules/manifest/schemas/manifest.schema.ts
- [X] T045 [P] [US2] Create ManifestRequestDto in app/openad-api/src/modules/manifest/dto/manifest-request.dto.ts
- [X] T046 [P] [US2] Create ManifestResponseDto in app/openad-api/src/modules/manifest/dto/manifest-response.dto.ts
- [X] T047 [US2] Implement ConstraintEvaluatorService for geofence/time/speed evaluation in app/openad-api/src/modules/manifest/evaluators/constraint-evaluator.service.ts
- [X] T048 [US2] Implement ManifestGeneratorService for creating device-specific manifests in app/openad-api/src/modules/manifest/generators/manifest-generator.service.ts
- [X] T049 [US2] Implement DeltaCalculatorService using JSON Patch for manifest diffs in app/openad-api/src/modules/manifest/generators/delta-calculator.service.ts
- [X] T050 [US2] Implement ManifestService orchestrating generation and caching in app/openad-api/src/modules/manifest/manifest.service.ts
- [X] T051 [US2] Implement ManifestController with POST /v1/manifest endpoint in app/openad-api/src/modules/manifest/manifest.controller.ts
- [X] T052 [US2] Implement POST /v1/manifest/sync-status endpoint in app/openad-api/src/modules/manifest/manifest.controller.ts
- [X] T053 [US2] Add Redis caching for manifests with 1-hour TTL
- [X] T054 [US2] Add rate limiting to manifest endpoint (10 req/min per device)
- [X] T055 [US2] Register ManifestModule in app module

### Tablet Implementation for User Story 2

- [X] T056 [P] [US2] Generate sync module using Nx: `nx g @nx/angular:module features/sync --project=openad-ad-client`
- [X] T057 [P] [US2] Create SyncState model in app/openad-ad-client/src/app/features/sync/models/sync-state.model.ts
- [X] T058 [P] [US2] Create DownloadProgress model in app/openad-ad-client/src/app/features/sync/models/download-progress.model.ts
- [X] T059 [US2] Implement ManifestClientService for fetching manifests from API in app/openad-ad-client/src/app/features/sync/services/manifest-client.service.ts
- [X] T060 [US2] Implement DownloadManagerService with HTTP Range Requests for resumable downloads in app/openad-ad-client/src/app/features/sync/services/download-manager.service.ts
- [X] T061 [US2] Implement HashVerifierService for SHA-256 verification using Web Crypto API in app/openad-ad-client/src/app/features/sync/services/hash-verifier.service.ts
- [X] T062 [US2] Implement StorageManagerService using Capacitor Filesystem API in app/openad-ad-client/src/app/features/sync/services/storage-manager.service.ts
- [X] T063 [US2] Implement SyncOrchestratorService coordinating manifest fetch, downloads, verification, and pruning in app/openad-ad-client/src/app/features/sync/services/sync-orchestrator.service.ts
- [X] T064 [US2] Add exponential backoff retry logic to DownloadManagerService
- [X] T065 [US2] Add download progress tracking with IndexedDB persistence
- [X] T066 [US2] Implement storage pruning logic (delete lowest-priority ads when full) in StorageManagerService
- [X] T067 [US2] Add sync status reporting to API after successful sync

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - tablets can fetch manifests and sync media

---

## Phase 5: User Story 3 - Passenger Views Continuous Ad Loop (Priority: P1)

**Goal**: Enable continuous ad playback with priority-based loop, constraint filtering, and factory default fallback

**Independent Test**: Observe the tablet display for 30 minutes and verify ads play continuously without repetition, gaps, or errors

### Tests for User Story 3 (TDD - Write First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T068 [P] [US3] Unit test for PlaybackEngineService in app/openad-ad-client/src/app/features/playback/services/playback-engine.service.spec.ts
- [X] T069 [P] [US3] Unit test for LoopManagerService in app/openad-ad-client/src/app/features/playback/services/loop-manager.service.spec.ts
- [X] T070 [P] [US3] Unit test for ConstraintFilterService in app/openad-ad-client/src/app/features/playback/services/constraint-filter.service.spec.ts

### Implementation for User Story 3

- [X] T071 [P] [US3] Generate playback module using Nx: `nx g @nx/angular:module features/playback --project=openad-ad-client`
- [X] T072 [P] [US3] Create PlaybackState model in app/openad-ad-client/src/app/features/playback/models/playback-state.model.ts
- [X] T073 [P] [US3] Create Ad and PriorityAd models in app/openad-ad-client/src/app/features/playback/models/ad-queue.model.ts
- [X] T074 [US3] Implement ConstraintFilterService for time/geofence/speed filtering in app/openad-ad-client/src/app/features/playback/services/constraint-filter.service.ts
- [X] T075 [US3] Implement PriorityQueueService for ad queue management in app/openad-ad-client/src/app/features/playback/services/priority-queue.service.ts
- [X] T076 [US3] Implement LoopManagerService preventing consecutive repeats in app/openad-ad-client/src/app/features/playback/services/loop-manager.service.ts
- [X] T077 [US3] Implement PlaybackEngineService orchestrating playback loop in app/openad-ad-client/src/app/features/playback/services/playback-engine.service.ts
- [X] T078 [US3] Create VideoPlayerComponent using HTML5 video element in app/openad-ad-client/src/app/features/playback/components/video-player/
- [X] T079 [US3] Create PlaybackControllerComponent managing playback state in app/openad-ad-client/src/app/features/playback/components/playback-controller/
- [X] T080 [US3] Implement factory default loop loading from Capacitor assets
- [X] T081 [US3] Add seamless transition logic (preload next ad while current plays)
- [X] T082 [US3] Add error handling for playback failures (skip to next ad)
- [X] T083 [US3] Extend DeviceInfoService to report GPS location and speed in app/openad-ad-client/src/app/core/services/device-info.service.ts
- [X] T084 [US3] Integrate PlaybackEngine with SyncOrchestrator (rebuild queue on manifest update)

**Checkpoint**: All P1 user stories complete - MVP is functional (upload, sync, playback)

---

## Phase 6: User Story 4 - System Delivers Priority/Emergency Ad (Priority: P2)

**Goal**: Enable real-time priority ad delivery via MQTT with queue management and loop resumption

**Independent Test**: Send an MQTT priority command while a normal ad is playing, and verify the priority ad plays next before returning to the standard loop

### Tests for User Story 4 (TDD - Write First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T085 [P] [US4] Unit test for PriorityCommandsGateway in app/openad-api/src/modules/priority-commands/priority-commands.gateway.spec.ts
- [X] T086 [P] [US4] Integration test for MQTT priority commands in app/openad-api/src/test/integration/priority-commands.integration.spec.ts
- [X] T087 [P] [US4] Unit test for MqttClientService in app/openad-ad-client/src/app/features/mqtt/services/mqtt-client.service.spec.ts

### Backend Implementation for User Story 4

- [X] T088 [P] [US4] Generate priority-commands module using Nx: `nx g @nx/nest:module priority-commands --project=openad-api --directory=modules/priority-commands`
- [X] T089 [P] [US4] Create PriorityCommandDto in app/openad-api/src/modules/priority-commands/dto/priority-command.dto.ts
- [X] T090 [US4] Implement PriorityCommandsGateway for MQTT publishing in app/openad-api/src/modules/priority-commands/priority-commands.gateway.ts
- [X] T091 [US4] Add MQTT connection setup with TLS in PriorityCommandsGateway
- [X] T092 [US4] Implement sendPriorityCommand method with topic routing (device-specific vs broadcast)
- [X] T093 [US4] Implement acknowledgment handler subscribing to devices/+/priority/ack
- [X] T094 [US4] Add command validation using PriorityCommandSchema from mqtt-contracts
- [X] T095 [US4] Register PriorityCommandsModule in app module

### Tablet Implementation for User Story 4

- [X] T096 [P] [US4] Generate mqtt module using Nx: `nx g @nx/angular:module features/mqtt --project=openad-ad-client`
- [X] T097 [US4] Implement MqttClientService using @capgo/capacitor-mqtt in app/openad-ad-client/src/app/features/mqtt/services/mqtt-client.service.ts
- [X] T098 [US4] Add MQTT connection setup with JWT authentication in MqttClientService
- [X] T099 [US4] Subscribe to device-specific and broadcast priority topics
- [X] T100 [US4] Implement priority command handler with expiration check
- [X] T101 [US4] Implement acknowledgment publishing to devices/{deviceId}/priority/ack
- [X] T102 [US4] Add reconnection logic with exponential backoff
- [X] T103 [US4] Integrate MqttClientService with PlaybackEngine (queue priority ads)
- [X] T104 [US4] Implement priority queue in PlaybackEngine (separate from normal queue)
- [X] T105 [US4] Add loop position tracking for resuming after priority ad

**Checkpoint**: User Story 4 complete - priority commands work end-to-end

---

## Phase 7: User Story 5 - Admin Targets Ads by Geography (Priority: P3)

**Goal**: Enable geofence-based ad targeting with automatic download/removal based on GPS location

**Independent Test**: Create a geofenced ad, place a tablet inside the geofence boundary, verify it downloads the ad, then move the tablet outside the boundary and confirm it removes the ad

### Tests for User Story 5 (TDD - Write First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T106 [P] [US5] Unit test for geofence constraint evaluation in ConstraintEvaluatorService
- [X] T107 [P] [US5] Integration test for geofenced manifest generation

### Implementation for User Story 5

- [X] T108 [US5] Implement point-in-polygon test for geofence evaluation in ConstraintEvaluatorService (use turf.js or similar)
- [X] T109 [US5] Add geofence constraint support to ManifestGeneratorService
- [X] T110 [US5] Update MediaIngestionController to accept geofence constraints in upload
- [X] T111 [US5] Add geofence filtering to ConstraintFilterService on tablet
- [X] T112 [US5] Implement GPS location reporting from tablet to API in DeviceInfoService
- [X] T113 [US5] Add geofence constraint UI in admin interface (if applicable)

**Checkpoint**: User Story 5 complete - geofence targeting works

---

## Phase 8: User Story 6 - Admin Schedules Time-Based Ad Rotation (Priority: P3)

**Goal**: Enable time-of-day constraints for ad scheduling with automatic filtering during playback

**Independent Test**: Create an ad with a time constraint of 2pm-4pm, observe the tablet at 1:55pm (ad should not play), 2:05pm (ad should play), and 4:05pm (ad should not play)

### Tests for User Story 6 (TDD - Write First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T114 [P] [US6] Unit test for time window constraint evaluation in ConstraintEvaluatorService
- [X] T115 [P] [US6] Unit test for time-based filtering in ConstraintFilterService

### Implementation for User Story 6

- [X] T116 [US6] Implement time window evaluation (UTC-based) in ConstraintEvaluatorService
- [X] T117 [US6] Add time window constraint support to ManifestGeneratorService
- [X] T118 [US6] Update MediaIngestionController to accept time window constraints in upload
- [X] T119 [US6] Add time-based filtering to ConstraintFilterService on tablet
- [X] T120 [US6] Implement fallback to factory default when all ads filtered by time
- [X] T121 [US6] Add time window constraint UI in admin interface (if applicable)

**Checkpoint**: User Story 6 complete - time-based scheduling works

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T122 [P] Add structured logging with nestjs-pino to all backend services
- [X] T123 [P] Add performance monitoring for manifest generation (<200ms target)
- [X] T124 [P] Add performance monitoring for delta calculation (<5s for 1000 devices)
- [X] T125 [P] Generate OpenAPI documentation using @nestjs/swagger
- [X] T126 [P] Add security headers and CORS configuration
- [X] T127 [P] Implement BullMQ job queue for async hash calculation
- [X] T128 [P] Implement BullMQ job queue for file cleanup
- [X] T129 [P] Add health check endpoint using @nestjs/terminus
- [X] T130 [P] Add metrics endpoint for Prometheus/Grafana
- [X] T131 [P] Create Docker Compose file for production deployment
- [X] T132 [P] Create Dockerfile for backend API with FFmpeg
- [X] T133 [P] Create Capacitor build configuration for Android APK
- [X] T134 [P] Add E2E tests using Playwright for critical user flows
- [X] T135 [P] Run linter and fix all violations: `nx lint openad-api && nx lint openad-ad-client`
- [X] T136 [P] Verify code coverage meets 80% threshold
- [X] T137 [P] Update README.md with quickstart instructions
- [X] T138 [P] Validate quickstart.md by following all steps
- [X] T139 Code cleanup and refactoring across all modules
- [X] T140 Security audit (input validation, rate limiting, JWT expiration)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 (needs MediaAsset schema)
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Depends on US2 (needs manifest and sync)
- **User Story 4 (P2)**: Can start after US3 complete - Integrates with playback engine
- **User Story 5 (P3)**: Can start after US2 complete - Extends manifest generation
- **User Story 6 (P3)**: Can start after US2 complete - Extends manifest generation

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD)
- Schemas before services
- Services before controllers/components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- All tests for a user story marked [P] can run in parallel
- Schemas/models within a story marked [P] can run in parallel
- US5 and US6 can be worked on in parallel (both extend manifest generation independently)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (TDD - write first):
Task T018: "Unit test for VideoValidatorService"
Task T019: "Unit test for HashGeneratorService"
Task T020: "Unit test for S3StorageService"
Task T021: "Integration test for media upload endpoint"

# After tests fail, launch all parallel implementation tasks:
Task T022: "Generate media-ingestion module"
Task T023: "Create MediaAsset Mongoose schema"
Task T024: "Create UploadMediaDto"
Task T025: "Create MediaValidationErrorDto"
```

---

## Implementation Strategy

### MVP First (User Stories 1, 2, 3 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Admin uploads ads)
4. Complete Phase 4: User Story 2 (Tablet syncs manifest)
5. Complete Phase 5: User Story 3 (Passenger views ads)
6. **STOP and VALIDATE**: Test all three stories together
7. Deploy/demo MVP

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo (MVP!)
5. Add User Story 4 → Test independently → Deploy/Demo (Priority commands)
6. Add User Story 5 → Test independently → Deploy/Demo (Geofencing)
7. Add User Story 6 → Test independently → Deploy/Demo (Time-based)
8. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Backend - Media Ingestion)
   - Developer B: User Story 2 Backend (Manifest Generation)
   - Developer C: User Story 2 Tablet (Sync)
3. After US1 and US2 complete:
   - Developer A: User Story 4 (Priority Commands)
   - Developer B: User Story 5 (Geofencing)
   - Developer C: User Story 3 (Playback) + User Story 6 (Time-based)
4. Stories complete and integrate independently

---

## Task Summary

**Total Tasks**: 140

**Tasks by Phase**:
- Phase 1 (Setup): 6 tasks
- Phase 2 (Foundational): 11 tasks
- Phase 3 (US1 - Admin Uploads): 19 tasks
- Phase 4 (US2 - Tablet Sync): 31 tasks
- Phase 5 (US3 - Playback): 17 tasks
- Phase 6 (US4 - Priority Commands): 21 tasks
- Phase 7 (US5 - Geofencing): 8 tasks
- Phase 8 (US6 - Time-based): 8 tasks
- Phase 9 (Polish): 19 tasks

**Parallel Opportunities**: 67 tasks marked [P] can run in parallel within their phase

**Independent Test Criteria**:
- US1: Upload video → appears in catalog with hash
- US2: Fetch manifest → download 3 ads → update manifest → add 1, remove 1
- US3: Observe 30 min playback → no gaps, no repeats, no errors
- US4: Send MQTT command → priority ad plays next → loop resumes
- US5: Create geofenced ad → tablet inside downloads → tablet outside removes
- US6: Create time-constrained ad → plays only during time window

**Suggested MVP Scope**: User Stories 1, 2, 3 (Phases 1-5) = 84 tasks

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD - Principle VI)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Follow quickstart.md for detailed implementation guidance
- All file paths are exact - ready for LLM execution
