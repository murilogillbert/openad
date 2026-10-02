# Research: MDM APK Distribution & Updates

**Feature**: `specs/009-mdm-apk-distribution/spec.md`  
**Created**: 2026-04-21

## Decision 1: Device Owner provisioning via QR

- **Decision**: Use Android’s built-in managed provisioning QR flow for freshly reset devices to provision **Device Owner** and install/configure the DPC app.
- **Rationale**: Scales installations without adb; matches dedicated device workflows; enables silent lock-task configuration and kiosk behavior.
- **Alternatives considered**:
  - adb `dpm set-device-owner …` (development-only, not scalable)
  - Google “Android Device Policy” enrollment (external dependency; not first-party)

### Key provisioning fields (high level)

- The QR payload must identify the Device Admin component (DPC receiver) and provide a download location for the APK.
- The QR payload must include an integrity value so the platform can verify the downloaded artifact before provisioning.

## Decision 2: Silent updates + staged rollout

- **Decision**: Devices update silently (no prompts) and rollouts can be staged by device group and/or rollout percentage.
- **Rationale**: Dedicated devices should be unattended; staged rollout reduces fleet-wide blast radius.
- **Alternatives considered**:
  - prompted updates (requires on-site interaction)
  - immediate global rollout (higher operational risk)

## Decision 3: Install QR targets “latest approved stable”

- **Decision**: QR installs the latest approved stable release, independent of staged rollout settings (which apply to updates post-install).
- **Rationale**: Install flow must be deterministic and simple for field operators; staged rollout is an operational update safety mechanism.

## Decision 4: In-app update mechanism on Device Owner devices

- **Decision**: The device downloads the candidate APK, verifies integrity, then installs it as an update without user prompts.
- **Rationale**: No Play Store; kiosk devices must update via first-party control.
- **Alternatives considered**:
  - Play Store in-app updates (not applicable)
  - manual sideload (not scalable)

## Open items (deferred to planning/design)

- How release artifacts are stored (object storage vs filesystem) and retention policy.
- Exact command semantics for “check updates now” in MQTT.
- Operational roll-out controls UI (groups vs percentage-only).

