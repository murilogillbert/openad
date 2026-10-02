# Contract: Platform Configuration Console

This document defines the behaviour of fleet-wide configuration editing.

## Get current configuration

- **Purpose**: Render cards with current active values
- **Actor**: authenticated administrator
- **Response**:
  - active configuration values (fleet-wide)
  - defaults (reference values) or a way to restore defaults
  - version identifier for conflict detection (if used)

## Edit configuration (client-side draft)

- **Purpose**: Allow the admin to change values without applying them immediately
- **Rules**:
  - Changes do not apply until explicit Save
  - A “Save Changes” banner appears when there are pending edits
  - The admin can discard pending edits

## Save changes

- **Purpose**: Apply pending edits as the new fleet-wide active configuration
- **Rules**:
  - Must validate values; errors are shown to the admin
  - Must record an audit entry including who changed what
  - Applies fleet-wide (no group/device scoping in v1)

## Restore defaults

- **Purpose**: Revert configuration back to factory defaults
- **Rules**:
  - Explicit confirmation required
  - Must record an audit entry
