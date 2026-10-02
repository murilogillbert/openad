# Contract: Release Manifest (device-readable)

**Purpose**: Device checks for latest stable + staged rollout eligibility  
**Feature**: `specs/009-mdm-apk-distribution/spec.md`

## Latest Stable (QR install target)

- **GET** latest stable release manifest

**Response fields**

- `channel`: `"stable"`
- `latest`: object
  - `versionIdentifier`: string
  - `downloadUrl`: string
  - `integrity`: object (sufficient to validate download)

## Update Eligibility (staged rollout)

- **GET** update manifest for a specific device

**Response fields**

- `deviceId`: string
- `current`: `{ versionIdentifier: string }`
- `eligible`: boolean
- `target`: nullable object
  - `versionIdentifier`: string
  - `downloadUrl`: string
  - `integrity`: object

