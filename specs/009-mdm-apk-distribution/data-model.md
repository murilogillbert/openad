# Data Model: MDM APK Distribution & Updates

**Created**: 2026-04-21  
**Feature**: `specs/009-mdm-apk-distribution/spec.md`

## Release

Represents a versioned Android application artifact available for installation and/or update.

- **id**: unique identifier
- **versionIdentifier**: human-visible version string (e.g., semantic version)
- **buildNumber**: monotonically increasing build identifier (if used)
- **uploadedAt**: timestamp
- **uploadedBy**: actor reference
- **status**: `uploaded | approved | revoked`
- **channel**: `stable` (v1; future: beta)
- **artifact**:
  - **downloadUrl**: stable server URL for the APK
  - **sizeBytes**
  - **integrity**: cryptographic integrity information sufficient for client verification (e.g., checksum + signing identity reference)

## ReleasePublication (Latest Stable Pointer)

Represents “latest approved stable” used by QR installs.

- **channel**: `stable`
- **releaseId**: points to Release
- **publishedAt**
- **publishedBy**

## Rollout

Controls staged rollout eligibility for updates.

- **id**
- **releaseId**: approved release being rolled out
- **status**: `draft | active | paused | completed | cancelled`
- **eligibility**:
  - **deviceGroups**: list of groups (optional)
  - **percentage**: 0–100 (optional; applied deterministically)
- **startedAt**
- **endedAt**

## Device

Represents a managed device instance.

- **id**
- **identity**: stable unique identifier (e.g., deviceId already used elsewhere)
- **lastSeenAt**
- **currentRelease**:
  - **versionIdentifier**
  - **installedAt**
- **updateState**:
  - **lastCheckAt**
  - **lastCheckResult**: `up_to_date | update_available | update_failed | unknown`
  - **lastError** (optional)

## AuditEvent

Immutable audit trail for sensitive actions.

- **id**
- **timestamp**
- **actor**
- **action**: `release.upload | release.approve | release.revoke | release.publish_latest | rollout.create | rollout.activate | rollout.pause | rollout.complete | qr.regenerate`
- **subject**: release/rollout/qr id
- **metadata**: limited, non-sensitive context

