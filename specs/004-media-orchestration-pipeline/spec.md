# Feature Specification: Media Orchestration & Manifest Pipeline

**Feature Branch**: `004-media-orchestration-pipeline`  
**Created**: 2026-04-05  
**Status**: Draft  
**Input**: User description: "Feature: Media Orchestration & Manifest Pipeline"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin Uploads Valid Advertisement (Priority: P1)

An advertiser uploads a video file through the admin interface. The system validates the file against technical constraints (bitrate, resolution, codec, file size), generates a unique content hash, and makes it available for distribution to tablets.

**Why this priority**: This is the entry point for all content in the system. Without validated media ingestion, no ads can be distributed or played.

**Independent Test**: Can be fully tested by uploading a compliant video file through the admin interface and verifying it appears in the available media catalog with a unique hash identifier.

**Acceptance Scenarios**:

1. **Given** an advertiser has a video file meeting all technical requirements, **When** they upload it through the admin interface, **Then** the system accepts the file, generates a SHA-256 hash, and stores it in the media catalog
2. **Given** an advertiser uploads a video with excessive bitrate, **When** the validation runs, **Then** the system rejects the file with a clear error message explaining the bitrate constraint violation
3. **Given** a video file has been successfully ingested, **When** the admin views the media catalog, **Then** they see the file listed with its hash, file size, and technical specifications

---

### User Story 2 - Tablet Receives and Synchronizes Manifest (Priority: P1)

A tablet connects to the network and receives a manifest describing which ads should be in its local storage. The tablet compares this manifest to its current state and downloads only the new or changed media files.

**Why this priority**: This is the core synchronization mechanism. Without it, tablets cannot receive updated content or maintain the correct playback state.

**Independent Test**: Can be fully tested by providing a tablet with a manifest containing 3 ads, verifying all 3 download successfully, then sending an updated manifest with 1 new ad and 1 removed ad, and confirming the tablet adds the new file and deletes the removed one.

**Acceptance Scenarios**:

1. **Given** a tablet has no local media, **When** it receives its first manifest with 5 ads, **Then** it downloads all 5 files and verifies each hash before adding to the playback queue
2. **Given** a tablet has 3 ads locally, **When** it receives a manifest adding 1 new ad and removing 1 existing ad, **Then** it downloads only the new ad and deletes the removed ad after successful download
3. **Given** a tablet is downloading a large file, **When** the connection drops at 60% completion, **Then** the tablet resumes the download from 60% when connectivity returns

---

### User Story 3 - Passenger Views Continuous Ad Loop (Priority: P1)

A passenger enters a vehicle and sees ads playing in a continuous loop on the tablet. The loop prevents the same ad from repeating consecutively and never shows an empty screen or error state.

**Why this priority**: This is the end-user experience that generates revenue. Without smooth, continuous playback, the entire system fails its business purpose.

**Independent Test**: Can be fully tested by observing the tablet display for 30 minutes and verifying ads play continuously without repetition, gaps, or errors.

**Acceptance Scenarios**:

1. **Given** a tablet has 4 ads in its local storage, **When** the playback loop runs, **Then** ads play sequentially without the same ad appearing twice in a row
2. **Given** a tablet has completed its manifest synchronization, **When** the playback loop reaches the end, **Then** it seamlessly restarts from the first ad without any visible pause or loading state
3. **Given** a tablet has no downloaded ads and no network connection, **When** the app launches, **Then** it plays a factory default loop embedded in the app to ensure passengers never see an empty screen

---

### User Story 4 - System Delivers Priority/Emergency Ad (Priority: P2)

An operator sends an emergency broadcast command via MQTT. The tablet receives this command, finishes playing the current ad, immediately plays the priority ad, then returns to the normal loop.

**Why this priority**: Enables time-sensitive messaging (safety alerts, urgent promotions) but is not required for basic ad playback functionality.

**Independent Test**: Can be fully tested by sending an MQTT priority command while a normal ad is playing, and verifying the priority ad plays next before returning to the standard loop.

**Acceptance Scenarios**:

1. **Given** a tablet is playing ad #2 of 5 in the normal loop, **When** an MQTT priority command is received, **Then** the tablet finishes ad #2, plays the priority ad, then resumes at ad #3
2. **Given** a priority ad is already playing, **When** another priority command is received, **Then** the new priority ad queues and plays after the current priority ad completes
3. **Given** a priority ad has finished playing, **When** the system returns to normal loop, **Then** it resumes at the correct position without replaying ads that already showed

---

### User Story 5 - Admin Targets Ads by Geography (Priority: P3)

An advertiser creates a campaign that should only display in vehicles within a specific geographic region. The system marks these ads as "conditional" and tablets only download them when their GPS location matches the geofence criteria.

**Why this priority**: Enables advanced targeting features but is not essential for basic system operation. Can be added after core playback functionality is stable.

**Independent Test**: Can be fully tested by creating a geofenced ad, placing a tablet inside the geofence boundary, and verifying it downloads the ad, then moving the tablet outside the boundary and confirming it does not download or removes the ad.

**Acceptance Scenarios**:

1. **Given** an ad is marked as conditional with a geofence around downtown, **When** a tablet's GPS shows it is downtown, **Then** the manifest includes this ad and the tablet downloads it
2. **Given** a tablet has a geofenced ad downloaded, **When** the vehicle moves outside the geofence, **Then** the next manifest update removes this ad and the tablet deletes the local file
3. **Given** an ad is marked as universal, **When** any tablet requests its manifest, **Then** the ad is included regardless of GPS location

---

### User Story 6 - Admin Schedules Time-Based Ad Rotation (Priority: P3)

An advertiser wants their ad to only play during specific hours (e.g., breakfast ads 6-10am, dinner ads 5-9pm). The system includes time-of-day constraints in the manifest and the tablet respects these constraints during playback.

**Why this priority**: Enhances ad relevance and value but is not critical for initial system deployment. Can be layered on after core functionality is proven.

**Independent Test**: Can be fully tested by creating an ad with a time constraint of 2pm-4pm, observing the tablet at 1:55pm (ad should not play), 2:05pm (ad should play), and 4:05pm (ad should not play).

**Acceptance Scenarios**:

1. **Given** an ad has a time constraint of 6am-10am, **When** the current time is 9:30am, **Then** the ad is included in the active playback loop
2. **Given** an ad has a time constraint of 6am-10am, **When** the current time is 11am, **Then** the ad is skipped and the next eligible ad plays
3. **Given** all ads in the manifest have time constraints and none are currently active, **When** the playback loop runs, **Then** the system plays the factory default loop until a time-constrained ad becomes eligible

---

### Edge Cases

- What happens when a tablet's storage is full and a new manifest requires downloading additional ads?
- How does the system handle a manifest that removes all ads, leaving the tablet with nothing to play?
- What happens if a downloaded file's hash verification fails after download completes?
- How does the system behave when a tablet has been offline for days and receives a manifest with many changes?
- What happens if an MQTT priority command references a media file that hasn't been downloaded yet?
- How does the system handle a tablet that loses GPS signal while playing geofenced ads?
- What happens when the API is unreachable and the tablet cannot fetch an updated manifest?
- How does the system handle corrupt or incomplete manifest JSON?
- What happens if two ads have the same priority value in the manifest?
- How does the system behave when a download is interrupted multiple times at different percentages?

## Requirements *(mandatory)*

### Functional Requirements

#### Media Ingestion (Admin/API)

- **FR-001**: System MUST validate all uploaded video files against maximum bitrate, resolution, codec compatibility, and file size constraints before accepting them
- **FR-002**: System MUST reject files that fail validation with specific error messages indicating which constraint was violated
- **FR-003**: System MUST generate a unique SHA-256 content hash for every accepted video file at the moment of ingestion
- **FR-004**: System MUST use the content hash as the primary identifier for media files across the entire network
- **FR-005**: System MUST allow administrators to categorize media as either "Universal" (distributed to all tablets) or "Conditional" (distributed based on criteria)
- **FR-006**: System MUST support geofence criteria for conditional media, specifying geographic boundaries where the ad should be displayed
- **FR-007**: System MUST support time-of-day constraints for media, specifying hours when the ad should be eligible for playback
- **FR-008**: System MUST support speed-based constraints for media, specifying vehicle speed ranges when the ad should be displayed

#### Manifest Generation & Delivery (API)

- **FR-009**: System MUST generate a JSON manifest for each tablet describing its desired local media state
- **FR-010**: Manifest MUST include for each media item: unique media ID, content hash, priority value, and any applicable constraints (time, geofence, speed)
- **FR-011**: System MUST calculate delta updates between a tablet's current manifest and the new desired state
- **FR-012**: System MUST send only the delta (additions and removals) when a tablet's manifest changes, not the full manifest
- **FR-013**: System MUST send the full manifest when a tablet connects for the first time or after a full reset
- **FR-014**: System MUST evaluate conditional media criteria (geofence, time, speed) based on tablet-reported state when generating manifests

#### Edge Synchronization (Tablet)

- **FR-015**: Tablet MUST download all media files specified in the manifest that are not already in local storage
- **FR-016**: Tablet MUST verify the SHA-256 hash of each downloaded file against the hash in the manifest
- **FR-017**: Tablet MUST NOT add a media file to the active playback queue until hash verification is 100% successful
- **FR-018**: Tablet MUST delete local media files that are no longer present in the received manifest
- **FR-019**: Tablet MUST only delete removed media files AFTER successfully downloading and verifying all new media files
- **FR-020**: Tablet MUST support resumable downloads using byte-range requests
- **FR-021**: Tablet MUST resume interrupted downloads from the last successfully received byte when connectivity returns
- **FR-022**: Tablet MUST track download progress and retry failed downloads with exponential backoff
- **FR-023**: Tablet MUST manage local storage by deleting removed media to reclaim space
- **FR-024**: Tablet MUST automatically delete lowest-priority ads when storage is full to make room for new downloads specified in the manifest

#### Playback Logic (Tablet)

- **FR-025**: Tablet MUST play ads in a continuous loop based on the priority values in the manifest
- **FR-026**: Tablet MUST prevent the same ad from playing twice consecutively unless it is the only ad available
- **FR-027**: Tablet MUST respect time-of-day constraints and skip ads that are outside their eligible time windows
- **FR-028**: Tablet MUST respect geofence constraints and skip ads when the vehicle is outside the defined geographic boundary
- **FR-029**: Tablet MUST respect speed-based constraints and skip ads when the vehicle speed is outside the defined range
- **FR-030**: Tablet MUST receive MQTT commands for priority/emergency ad playback
- **FR-031**: Tablet MUST finish the currently playing ad before switching to a priority ad
- **FR-032**: Tablet MUST return to the normal loop at the correct position after a priority ad completes
- **FR-033**: Tablet MUST play a factory default loop (embedded in the APK) when no downloaded ads are available
- **FR-034**: Tablet MUST never display an empty screen, loading spinner, or OS error to passengers
- **FR-035**: Tablet MUST transition seamlessly between ads without visible gaps or buffering

### Key Entities

- **Media Asset**: Represents a video file with attributes including unique media ID, content hash (SHA-256), file size, bitrate, resolution, codec, upload timestamp, and categorization (universal or conditional)
- **Manifest**: Represents the desired state for a specific tablet, containing a list of media items with their IDs, hashes, priorities, and constraints; includes a version number or timestamp for delta calculation
- **Tablet**: Represents a physical device with attributes including unique device ID, current GPS location, current speed, local storage capacity, currently downloaded media (with hashes), and last manifest version received
- **Priority Command**: Represents an MQTT message triggering immediate playback of a specific media item, containing media ID, priority level, and optional expiration timestamp
- **Constraint**: Represents conditional playback rules attached to media, including geofence boundaries (latitude/longitude polygons), time windows (start/end hours), and speed ranges (min/max km/h)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can upload a compliant video file and see it available in the media catalog within 30 seconds
- **SC-002**: Tablets synchronize their local media state to match the manifest within 5 minutes of receiving an update (assuming adequate network bandwidth)
- **SC-003**: Passengers experience continuous ad playback with zero visible gaps, errors, or empty screens during 95% of vehicle journeys
- **SC-004**: System successfully resumes interrupted downloads in 100% of cases where connectivity is restored within 24 hours
- **SC-005**: Priority/emergency ads display within 30 seconds of the MQTT command being sent (accounting for current ad completion)
- **SC-006**: Tablets correctly apply geofence constraints with 95% accuracy based on GPS location
- **SC-007**: System reduces network bandwidth usage by 70% compared to full manifest delivery by using delta updates
- **SC-008**: Hash verification catches 100% of corrupted or incomplete file downloads before they enter the playback queue
- **SC-009**: Factory default loop ensures passengers never see an empty screen, even when tablets have no network connectivity for extended periods
- **SC-010**: System handles 1000 concurrent tablet synchronization requests without degradation in manifest delivery time

## Assumptions

- Tablets have reliable GPS capability for geofence evaluation
- Network connectivity is intermittent but eventually available (not permanently offline)
- Administrators understand video encoding and can prepare files meeting technical constraints
- A single tablet serves one vehicle (not multiple tablets per vehicle in MVP)
- Tablets have sufficient storage for at least 20 high-quality video ads (approximately 2-5 GB)
- MQTT infrastructure for priority commands is already available and operational
- Video files are typically 30-120 seconds in length (standard ad duration)
- The admin interface for uploading media is a separate system that calls the ingestion API
- Tablets report their GPS location and speed to the API periodically (for manifest generation)
- The factory default loop consists of 2-3 generic ads embedded in the APK at build time
- Hash verification failures are rare and indicate network corruption, not malicious tampering
- Byte-range request support is available on the file storage/CDN infrastructure
- Tablets run on Android OS with sufficient processing power for video playback (as indicated by validation constraints)
- The system operates in regions with mobile data connectivity (3G/4G/5G)
