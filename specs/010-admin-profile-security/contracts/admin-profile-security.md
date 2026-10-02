# Contract: Admin Profile & Security

This document defines the externally visible behaviour of profile + security actions from the admin console.

## 1) Get current admin profile

- **Purpose**: Populate the Profile Details form
- **Actor**: authenticated administrator
- **Response** includes:
  - display name
  - contact details
  - profile photo reference (if any)

## 2) Update admin profile

- **Purpose**: Save name/contact details and optional photo change
- **Actor**: authenticated administrator
- **Rules**:
  - Validation errors are shown in a user-friendly manner
  - Audit entry is recorded for profile changes (if required by policy)

## 3) Change password

- **Purpose**: Replace current password with a new one
- **Actor**: authenticated administrator
- **Rules**:
  - Must enforce password policy requirements
  - Must record a security audit entry

## 4) List active sessions

- **Purpose**: Display where the admin is logged in
- **Actor**: authenticated administrator
- **Each session entry**:
  - device/browser label
  - last active time
  - “Active now” marker for the current session

## 5) Log out of all other devices

- **Purpose**: Revoke all sessions except the current one
- **Actor**: authenticated administrator
- **Rules**:
  - Current session remains active
  - All other sessions are invalidated immediately
  - Must record a security audit entry
