# Feature Specification: Tablet Ops Pipeline

**Feature Branch**: `003-tablet-ops-pipeline`  
**Created**: 2026-04-05  
**Status**: Draft  
**Input**: Secure Pairing Lifecycle, Command & Control Pipeline, Self-Healing Tablet, Delta Sync & Bandwidth Economy

---

## User Scenarios & Testing

### User Story 1 — Hardware-Locked Secure Pairing (Priority: P1)

A field technician installs a new tablet in a vehicle. Instead of typing a manual pairing code from a list, they open the tablet app, which automatically reads the device's hardware fingerprint (IMEI, serial number, and MAC address) and sends it to the admin panel. An administrator reviews the pending request and clicks "Generate Pairing Secret." A short-lived one-time code (valid for 10 minutes) appears on the admin screen. The technician types this code into the tablet. The system verifies that the hardware fingerprint attached to the secret matches the tablet presenting it, issues a permanent device token locked to that specific hardware, and provides the tablet with its first operating instructions: MQTT credentials and the URL to its first media manifest. If the tablet app is cloned or moved to different hardware, the token is automatically invalidated on the next request.

**Why this priority**: Secure pairing is the gate to everything else. Without a trustworthy hardware-to-account binding, a device cannot safely receive credentials, commands, or content. It also enables automated fleet onboarding without physical access to the admin backend.

**Independent Test**: Start with a factory-fresh, unregistered tablet. Open the app — it reads its own hardware identifiers and registers a pairing request. In the admin panel, a "Pending Pairing Requests" section shows the device. Generate a secret. Enter it on the tablet. Verify the device becomes `Active`, its token is issued, and the admin panel shows MQTT credentials delivered. Attempt to use the same token from a different device ID — verify it is rejected.

**Acceptance Scenarios**:

1. **Given** a new tablet with no prior registration, **When** the app starts for the first time, **Then** it reads its hardware fingerprint and sends a pairing request to the API; the device appears in the admin panel as `Pending`.
2. **Given** a device in `Pending` state, **When** an admin generates a pairing secret, **Then** a cryptographically random, one-time secret with a 10-minute TTL is created and displayed in the admin panel; the secret is not stored in plaintext.
3. **Given** a valid pairing secret, **When** the technician submits it from the correct tablet, **Then** the API validates the hardware fingerprint match, issues a permanent device-scoped token, upgrades the device to `Active`, and returns MQTT credentials and the manifest URL.
4. **Given** a valid pairing secret, **When** submitted from a tablet with a different hardware fingerprint, **Then** the API rejects the binding with a specific error and the device remains `Pending`.
5. **Given** a pairing secret older than 10 minutes, **When** the technician submits it, **Then** the API rejects it with a "secret expired" error; no token is issued.
6. **Given** a successfully paired device, **When** the app is cloned or the token is used from a request with a mismatched hardware fingerprint, **Then** the API rejects the request with a `403 Hardware Mismatch` error and logs a security event.
7. **Given** a secret that has already been used, **When** a replay attempt is made, **Then** the API rejects it; each secret is strictly single-use.

---

### User Story 2 — Remote Command & Control Pipeline (Priority: P2)

An administrator, sitting in the operations centre, needs to verify that a specific taxi is actively playing ads. They open the Fleet Monitor in the admin panel, select the device, and click "Request Screenshot." Within a few seconds, a thumbnail of the current playback frame appears in the panel. Separately, a field report indicates that a device has corrupted video files. The admin sends a `CLEAR_CACHE` command — the tablet wipes its local media and re-queues a full re-download without driver interaction. For fleet-wide software updates, the admin uploads a new APK and triggers an `UPGRADE_APP` command to a device group, delivering the download URL. At night, an admin adjusts the brightness and volume of devices in airport zones to improve the passenger experience.

**Why this priority**: Remote commands are the operational nervous system of a professional DOOH fleet. Without them, every fix requires a field visit. A single `CLEAR_CACHE` command can resolve ghost-ad issues that would otherwise take hours of technician time, and `GET_SCREENSHOT` provides the "proof of life" that revenue-generating advertisers demand.

**Independent Test**: From the admin panel, issue each of the four command types to a single connected device in a test bench. Verify: (a) a screenshot is uploaded and viewable within 15 seconds; (b) after `CLEAR_CACHE`, the local media directory is empty and the device begins re-downloading; (c) after `UPGRADE_APP`, the device downloads the APK from the provided URL and initiates installation; (d) after `SET_VOLUME` / `SET_BRIGHTNESS`, the system audio and display settings on the tablet change to the commanded values within 5 seconds.

**Acceptance Scenarios**:

1. **Given** an `Active` device with an established MQTT connection, **When** an admin dispatches a `GET_SCREENSHOT` command, **Then** the tablet captures a frame of the current media, uploads it via REST, and the admin panel shows the thumbnail within 15 seconds.
2. **Given** an `Active` device, **When** an admin dispatches `CLEAR_CACHE`, **Then** all locally cached media files are deleted, a cache-clear event is logged, and the tablet immediately re-queues a fresh download cycle from the manifest.
3. **Given** an admin with a new APK URL, **When** they dispatch `UPGRADE_APP` to a device, **Then** the tablet downloads the APK from the provided URL and initiates installation; the admin dashboard shows the command as `Delivered`, then `Acknowledged`.
4. **Given** a connected device, **When** an admin dispatches `SET_VOLUME` with a value from 0–100, **Then** the device system volume changes to the specified level within 5 seconds and the new value is confirmed back to the server.
5. **Given** a connected device, **When** an admin dispatches `SET_BRIGHTNESS` with a value from 0–100, **Then** the display brightness changes to the specified level within 5 seconds and the new value is confirmed back to the server.
6. **Given** a command dispatched to an `offline` or `Suspended` device, **When** the device reconnects, **Then** pending commands that are still within their TTL are delivered upon reconnect (MQTT persistent session); expired commands are discarded and marked `Expired` in the audit log.
7. **Given** a command issued, **When** the tablet acknowledges receipt and execution, **Then** the command record in the admin panel transitions from `Pending` → `Delivered` → `Acknowledged`, with timestamps for each stage.

---

### User Story 3 — Self-Healing Tablet Watchdog (Priority: P3)

When a taxi is parked overnight and the ignition is off, the tablet app detects that vehicle power has been disconnected. If the battery is below 20%, it enters a "Deep Sleep" mode — turning off the screen and suspending media operations — while keeping just enough process alive to maintain the MQTT heartbeat and report that it is sleeping. If the tablet has not successfully reached the content manifest API in 24 hours, it automatically switches to a "Safety Loop" — indefinitely cycling a default local asset (company branding/contact screen) — so that passengers never see an error screen. Once every 24 hours at 3 AM local time, the media player engine restarts silently in the background to clear accumulated memory leaks, without interrupting playback if the vehicle is in service.

**Why this priority**: The watchdog directly protects advertiser revenue and passenger experience. A tablet that goes blank or shows an error screen represents lost ad inventory. Deep Sleep protects the driver's vehicle battery. The Safety Loop is a contractual safety net. The 3 AM restart is a proven industry practice that keeps long-running kiosk apps stable for weeks without human intervention.

**Independent Test**: On a test device with the app running: (a) disconnect vehicle power and drop battery below 20% — verify the screen goes dark and heartbeat packets continue; (b) configure the app to point to an unreachable manifest URL and wait 24 hours (or fast-forward via config) — verify it switches to the safety loop asset; (c) wait for or trigger the 3 AM restart — verify the media player engine restarts without the app crashing or losing state.

**Acceptance Scenarios**:

1. **Given** the tablet is connected and battery drops below 20% after power disconnection, **When** this condition persists for more than the grace period (30 seconds), **Then** the screen turns off, media playback suspends, and the device publishes a `sleeping` status heartbeat; the MQTT connection is maintained.
2. **Given** a device in Deep Sleep, **When** vehicle power is reconnected, **Then** the screen turns on, media playback resumes, and the device publishes an `awake` status heartbeat within 15 seconds.
3. **Given** a device that has not successfully fetched its media manifest for 24 consecutive hours, **When** the next playback cycle begins, **Then** the device switches to a local fallback (Safety Loop) asset and logs a `manifest_unreachable` event.
4. **Given** a device in Safety Loop mode, **When** the manifest API becomes reachable again, **Then** the device automatically resumes normal content scheduling on the next successful manifest fetch.
5. **Given** the local device clock shows 3:00 AM, **When** the daily restart trigger fires, **Then** the media player engine restarts silently; if the vehicle is actively serving content, the restart is deferred until the current ad loop ends.
6. **Given** a device running continuously for more than 24 hours, **When** the daily restart occurs, **Then** no user-visible crash, black screen, or error state occurs during or after the restart.

---

### User Story 4 — Delta Sync and Bandwidth Economy (Priority: P4)

An advertiser updates their campaign — one new video replaces one old one. Instead of the tablet downloading the entire media manifest and all assets again, the API sends a diff: "Add campaign_video_new.mp4, remove campaign_video_old.mp4." The tablet downloads only the new file. Fleet managers can define "Sync Windows" in the Management App — for example, "only download files larger than 50 MB between 2:00 AM and 5:00 AM" — so that large video assets are fetched when the driver is home and connected to Wi-Fi, not consuming expensive cellular data while the car is in service.

**Why this priority**: Mobile data is the primary cost constraint for a moving DOOH fleet. Delta syncing directly reduces monthly data expenditure by 60–90% on stable campaigns. Sync Windows give fleet operators fine-grained control over when bandwidth is consumed, protecting carrier spend and improving driver experience.

**Independent Test**: Set up a campaign with 5 assets. Push a manifest update that adds 1 new asset and removes 1 old asset. Verify the tablet downloads exactly 1 file, not 5. Next, configure a Sync Window: "no downloads between 08:00 and 22:00." Trigger a sync at 10:00 AM with a large asset — verify the download is queued but not started. At 02:00 AM, verify the download proceeds automatically.

**Acceptance Scenarios**:

1. **Given** a device with a cached manifest, **When** the API sends a delta update, **Then** the device computes the diff, downloads only new assets, deletes removed assets, and does not re-download unchanged ones.
2. **Given** no prior cached manifest on a device (first sync), **When** the API sends a manifest, **Then** all assets are downloaded (full sync, no delta possible).
3. **Given** a manifest delta received outside of a configured Sync Window for large files, **When** the asset size exceeds the Sync Window threshold, **Then** the download is queued and will not begin until the Sync Window opens.
4. **Given** a Sync Window opens (e.g., 02:00 AM), **When** there are queued large-asset downloads, **Then** the tablet begins downloading them automatically without administrator intervention.
5. **Given** a configured Sync Window, **When** an admin updates the Sync Window rules in the Management App, **Then** the new rules are pushed to the affected devices via MQTT config update within one sync cycle (≤ 60 seconds).
6. **Given** a partial download interrupted by connectivity loss, **When** the device reconnects within an active Sync Window, **Then** the download resumes from where it stopped (byte-range resumption).
7. **Given** an admin who wants to force an immediate full re-sync (e.g., after a `CLEAR_CACHE` command), **When** they trigger a "Force Full Sync" action, **Then** the size threshold for the Sync Window is bypassed for that one sync cycle, and all assets are downloaded immediately.

---

### Edge Cases

- What happens when a pairing secret is requested but the device has already been paired? The API rejects the new request — once `Active`, a new pairing requires retiring the device first.
- What if the tablet cannot upload a screenshot (no connectivity)? The `GET_SCREENSHOT` command stays `Delivered` but moves to `Acknowledged_Failure` with a timeout after 60 seconds; the admin is notified.
- What if `UPGRADE_APP` is sent but the APK URL is unreachable? The tablet retries 3 times with backoff, then reports the command as `Failed` with reason `download_failed`.
- What if the 3 AM restart fires while the device is in Deep Sleep? The restart is skipped for that cycle — the device is already in a low-power, non-media state, so memory pressure is minimal.
- What if a manifest delta references an asset that was never downloaded (inconsistent state)? The device treats the missing asset as a new addition and downloads it in full.
- What if hardware fingerprint data (IMEI/MAC) is unavailable on the target device? The API rejects the pairing request and marks the device as `Pending` with flag `FINGERPRINT_UNAVAILABLE`, alerting the admin.
- What if two commands are queued for a device that then goes offline? Commands are delivered in order of dispatch when the device reconnects, subject to their individual TTLs.
- What happens during a Sync Window when the device loses connectivity mid-download? The download checkpoints byte position and retries from that position when connectivity is restored.

---

## Requirements

### Functional Requirements

**Secure Pairing**

- **FR-001**: The tablet app MUST automatically read and transmit its hardware fingerprint (IMEI, device serial, MAC address) to the API without requiring manual input from the technician.
- **FR-002**: The API MUST generate a cryptographically random, single-use pairing secret with a 10-minute TTL upon admin request for a pending device.
- **FR-003**: The API MUST validate that the hardware fingerprint presented at binding time exactly matches the fingerprint submitted in the original pairing request; any mismatch MUST be rejected with a `403 Hardware Mismatch` error and logged as a security event.
- **FR-004**: The API MUST issue a permanent device-scoped JWT that embeds the hardware fingerprint; any subsequent request presenting this token from a device with a different fingerprint MUST be rejected.
- **FR-005**: Upon successful binding, the API MUST deliver MQTT broker credentials and the initial media manifest URL to the device as part of the pairing response payload.
- **FR-006**: Once a pairing secret has been used (whether successfully or not after a matching fingerprint verification), it MUST be invalidated immediately and MUST NOT be reusable.
- **FR-007**: The system MUST maintain a log of all pairing attempts (success, failure, expired, replay) including the device fingerprint, timestamp, and outcome.

**Command & Control**

- **FR-008**: The API MUST support dispatching the following command types to individual devices: `GET_SCREENSHOT`, `CLEAR_CACHE`, `UPGRADE_APP`, `SET_VOLUME`, `SET_BRIGHTNESS`.
- **FR-009**: The tablet MUST acknowledge command receipt and report the final execution result (success or failure) back to the API via MQTT.
- **FR-010**: The API MUST track each command through a lifecycle: `Pending → Delivered → Acknowledged` (or `Acknowledged_Failure` or `Expired`); all transitions MUST be timestamped.
- **FR-011**: Commands dispatched to offline devices MUST be held in a persistent queue; they MUST be delivered to the device upon reconnection if the command's TTL has not expired.
- **FR-012**: Each command type MUST have a configurable TTL (default: `GET_SCREENSHOT`: 60 s; `CLEAR_CACHE`: 24 h; `UPGRADE_APP`: 72 h; `SET_VOLUME`/`SET_BRIGHTNESS`: 1 h); expired commands MUST be marked `Expired` without execution.
- **FR-013**: For `GET_SCREENSHOT`, the tablet MUST capture a frame of the currently displayed content and upload it to a pre-signed URL provided by the API; the upload MUST succeed within 60 seconds of command receipt.
- **FR-014**: For `UPGRADE_APP`, the API MUST validate that the provided APK URL is reachable before dispatching the command; the tablet MUST download the APK and initiate installation automatically.

**Self-Healing Watchdog**

- **FR-015**: The tablet MUST detect when vehicle power (charging) is disconnected AND the battery level is below 20%, and MUST enter Deep Sleep within the configured grace period (default 30 seconds).
- **FR-016**: In Deep Sleep, the tablet MUST turn off the display and pause media playback, while maintaining the MQTT heartbeat connection and reporting the `sleeping` status.
- **FR-017**: The tablet MUST automatically exit Deep Sleep and resume normal operation within 15 seconds of vehicle power being reconnected.
- **FR-018**: If the tablet has not successfully fetched a current media manifest for 24 consecutive hours, it MUST switch to a Safety Loop, playing a designated local fallback asset on continuous repeat.
- **FR-019**: The tablet MUST automatically exit Safety Loop mode and resume normal scheduling on the next successful manifest fetch, without requiring a restart or admin intervention.
- **FR-020**: The tablet MUST perform a silent media player engine restart once every 24 hours at 3:00 AM local device time.
- **FR-021**: If the media player engine restart fires while the device is actively playing content, the restart MUST be deferred until the current ad loop completes; if in Deep Sleep, the restart MUST be skipped for that cycle.

**Delta Sync & Bandwidth Economy**

- **FR-022**: The API MUST generate a manifest delta (added assets, removed assets) rather than the full asset list when a device already has a known manifest version.
- **FR-023**: The tablet MUST apply the manifest delta by downloading only newly added assets and deleting removed assets; unchanged assets MUST NOT be re-downloaded.
- **FR-024**: Administrators MUST be able to configure Sync Window rules per Device Group: a time window (start time, end time, days of week) and a size threshold (in MB) above which downloads are deferred until the window is open.
- **FR-025**: The tablet MUST queue downloads that exceed the Sync Window size threshold outside the window and MUST begin downloading them automatically when the window opens.
- **FR-026**: Sync Window configuration changes MUST be propagated to affected devices via MQTT within one sync cycle (≤ 60 seconds).
- **FR-027**: The tablet MUST support byte-range HTTP resumption for all media downloads; interrupted downloads MUST resume from the last confirmed byte position on reconnect.
- **FR-028**: An "Emergency Sync" command MUST bypass all Sync Window restrictions and force an immediate full re-download of the current manifest.

### Key Entities

- **PairingRequest**: A record of a tablet's hardware fingerprint registration attempt, including `deviceId`, `hardwareFingerprint` (IMEI, serial, MAC), `status`, and `expiresAt`.
- **PairingSecret**: A short-lived, single-use token with a 10-minute TTL, linked to a specific `PairingRequest` and hardware fingerprint. Contains a `usedAt` timestamp; once set, the secret is permanently invalidated.
- **RemoteCommand**: A command dispatched to a device with fields: `commandId`, `deviceId`, `type`, `payload`, `status`, `dispatchedAt`, `deliveredAt`, `acknowledgedAt`, `ttl`, `expiresAt`.
- **ManifestVersion**: A versioned snapshot of a device's known content manifest, used to compute deltas. Contains the list of `assetId`s at each version.
- **SyncWindowRule**: A rule attached to a Device Group specifying download scheduling: `startTime`, `endTime`, `daysOfWeek`, `sizeThresholdMb`.
- **WatchdogEvent**: A log entry recording key self-healing transitions: `deviceId`, `eventType` (deep_sleep_entered, deep_sleep_exited, safety_loop_entered, safety_loop_exited, player_restarted), `occurredAt`, `context`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A field technician can pair a new tablet with the fleet without accessing the admin backend directly; the end-to-end pairing flow (hardware fingerprint → secret generation → tablet input → token issued) completes in under 2 minutes.
- **SC-002**: A cloned or otherwise invalid device token is rejected within 1 request; no unauthorized device can successfully authenticate using a stolen or copied token.
- **SC-003**: A `GET_SCREENSHOT` command results in a viewable thumbnail appearing in the admin panel within 15 seconds from dispatch, under normal connectivity.
- **SC-004**: A `CLEAR_CACHE` command results in a confirmed cache wipe and re-download initiation within 30 seconds of dispatch, without driver interaction.
- **SC-005**: Remote volume and brightness adjustments take effect on the target device within 5 seconds of command dispatch.
- **SC-006**: A device entering Deep Sleep (ignition off, battery < 20%) continues to send heartbeat pulses for at least 4 hours without vehicle power.
- **SC-007**: A device in Safety Loop mode resumes normal content playback automatically within 60 seconds of the manifest API becoming reachable again.
- **SC-008**: No passenger-visible error screen or blank display occurs during or after the daily 3 AM media player restart.
- **SC-009**: On a campaign with 5 unchanged assets and 1 new asset, the tablet downloads exactly 1 file on the delta sync; total data transferred is reduced by at least 83% compared to a full re-sync.
- **SC-010**: Sync Window configuration changes take effect on all devices in a group within 60 seconds of the administrator saving the change.
- **SC-011**: A download interrupted by a connectivity drop resumes from its last byte position without re-downloading bytes already received.

---

## Assumptions

- The hardware fingerprint (IMEI, device serial number, MAC address) is accessible to the tablet app via the Android platform APIs on all target devices (Android 10+).
- The admin panel (Management App) is the sole source of pairing secret generation; field technicians do not have access to the admin backend and interact only via the tablet app.
- Pairing secrets are displayed in the admin panel as a short alphanumeric code (≤ 8 characters) suitable for manual entry by a non-technical technician; the underlying secret is a cryptographically secure random value.
- The fallback Safety Loop asset (company branding) is pre-bundled with the tablet app and does not require a network connection to play.
- The "3 AM restart" uses the device's local clock; fleet devices may be in different time zones, which is acceptable — the restart simply needs to occur during low-traffic hours.
- Command TTLs are configurable at the system level but default values are used unless overridden by the administrator at dispatch time.
- The `UPGRADE_APP` flow assumes Android's package installer is available and the device has "Install from unknown sources" or MDM-managed installation enabled.
- Delta sync requires the API to track each device's last acknowledged manifest version; devices without a tracked version receive a full manifest on first sync.
- Sync Window rules are defined at the Device Group level; individual device overrides are out of scope for this feature.
- The pre-signed screenshot upload URL is generated by the API and provided in the `GET_SCREENSHOT` command payload; the tablet uploads directly to cloud storage without routing through the API server.
