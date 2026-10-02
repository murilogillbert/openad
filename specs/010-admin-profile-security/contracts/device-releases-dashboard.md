# Contract: Device App Releases (MDM Dashboard)

This document defines the admin console behaviour for releases, QR provisioning, rollouts, and emergency actions.

## Master QR (Latest Stable)

- **Purpose**: Always point to the currently approved “Latest Stable” software
- **Actor**: admin / field technician (read)
- **Empty state**: If no stable release exists, show clear guidance and do not display a misleading QR.

## Download PDF

- **Purpose**: Provide a printable onboarding sheet for installers
- **Content**:
  - master QR code
  - concise 3-step setup instructions
  - no secrets

**API**

- **GET** `/api/v1/releases/stable-cheatsheet.pdf` (super_admin only)
  - **200**: `Content-Type: application/pdf` with attachment download
  - **404**: `{ "message": "No stable release published" }`

## Release ledger

- **Purpose**: Show history and current state of releases
- **Columns** (minimum):
  - version identifier
  - uploaded by
  - upload date
  - reach indicator (installed count)
  - status badge (Draft, Staged, Latest Stable, Archived)
- **Release notes**:
  - Visible to administrators and read-only field technicians
  - Not publicly accessible via QR/stable manifest flow

## Upload & rollout workflow

- **Purpose**: Upload new release and decide next action
- **Post-upload options**:
  - Save as Draft
  - Staged rollout (percentage and/or device group)
  - Make Latest Stable (immediate)

## Emergency Override: Force Update Check

- **Purpose**: Per-device action from vehicle monitoring to trigger immediate update check
- **Actor**: super-admin only
- **Audit**: action must be recorded

**Audit event**

- **action**: `release.force_update_check`
- **subjectId**: `deviceId`
- **metadata**: includes `deviceId` and `commandId`
