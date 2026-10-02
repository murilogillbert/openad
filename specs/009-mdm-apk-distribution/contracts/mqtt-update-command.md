# Contract: MQTT Update Check Command

**Purpose**: Remotely trigger an immediate update check  
**Feature**: `specs/009-mdm-apk-distribution/spec.md`

## Command

### Trigger update check

- **Intent**: Ask device to check for updates now and report result
- **Target**: a single device (v1)

### Expected outcomes

- If device is online, it starts the update check promptly and reports:
  - `up_to_date` / `update_available` / `update_started` / `update_failed`
- If device is offline, the command outcome is visible to operator (queued or failed), without breaking device state.

