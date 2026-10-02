# Data Model: Admin Console — Profile, Configuration, Releases

**Date**: 2026-04-22  
**Branch**: `010-admin-profile-security`

## Administrator Profile

Represents the administrator’s personal information for display and contact.

- **Fields (logical)**:
  - `adminId` (unique identifier)
  - `displayName`
  - `contactEmail` (may be the login email or separate contact field)
  - `contactPhone` (optional)
  - `photo` (reference to stored image or inline URL)
  - `updatedAt`

## Administrator Session

Represents an authenticated login session that can be listed and revoked.

- **Fields (logical)**:
  - `sessionId` (unique identifier)
  - `adminId` (owner)
  - `label` (device/browser label shown to user)
  - `lastActiveAt`
  - `isCurrent` (boolean)
  - `createdAt`

## Platform Configuration

Fleet-wide “master control board” settings. Applies to all devices in v1.

- **Fields (logical)**:
  - `activeConfig` (current effective config)
  - `draftConfig` (pending edits; optional if draft exists)
  - `hasPendingChanges` (derived)
  - `updatedByAdminId` (last writer)
  - `updatedAt`
  - `version` (monotonic number for conflict detection)

### Configuration Categories (logical)

- **Media limits**
  - max video size
  - max duration
  - max width/height
- **Fleet health**
  - minimum battery percentage
  - maximum storage usage percentage
- **Analytics validity thresholds**
  - maximum allowed velocity
  - other toggles/sliders as defined in the product

## App Release

Represents an uploaded release artifact and its admin-facing metadata.

- **Fields (logical)**:
  - `releaseId`
  - `versionIdentifier` (e.g., v1.3.0)
  - `releaseNotes` (visible to admins + read-only field technicians; not public)
  - `uploadedByAdminId`
  - `uploadedAt`
  - `status` (Draft | Staged | LatestStable | Archived)
  - `reachInstalledCount` (computed from device reports; may be approximate)

## Rollout

Represents staged deployment rules and current rollout state.

- **Fields (logical)**:
  - `rolloutId`
  - `releaseId`
  - `status` (Draft | Active | Paused | Cancelled | Completed)
  - `targetDeviceGroupIds` (optional)
  - `targetPercentage` (optional)
  - `startedAt` / `endedAt`

## Device Update State (for reach + troubleshooting)

Represents the last-known installed version and update check status per device.

- **Fields (logical)**:
  - `deviceId`
  - `installedVersionIdentifier`
  - `lastUpdateCheckAt`
  - `lastUpdateCheckResult`
  - `lastUpdateError` (optional)
