# Interface Contract: MQTT Topics

**Branch**: `001-transit-ad-platform-foundation`  
**Protocol**: MQTT 5.0  
**Transport**: TLS 1.3  
**Auth**: Client certificate (pinned at device binding) + broker ACL per `deviceId`

---

## Topic Namespace

All topics follow the pattern: `openad/{deviceId}/{subject}`

Each device may only publish/subscribe on topics under its own `deviceId`.  
The server may publish on any `openad/{deviceId}/*` topic and listens on all.

---

## Device → Server Topics

### `openad/{deviceId}/telemetry`
**QoS**: 0 (fire-and-forget; latest value replaces any missed heartbeat)  
**Frequency**: Every 30 seconds  
**Retained**: Yes (broker retains last value for new subscribers)

**Payload**
```json
{
  "ts": "ISO8601",
  "location": {
    "lat": "number",
    "lng": "number",
    "accuracyMeters": "number",
    "gpsLocked": "boolean"
  },
  "connectivity": {
    "networkType": "4G | 5G | WiFi | none",
    "signalStrengthDbm": "number | null"
  },
  "playback": {
    "status": "playing | idle | error",
    "currentAssetId": "string | null",
    "currentCampaignId": "string | null",
    "errorCode": "string | null"
  },
  "device": {
    "batteryPercent": "number",
    "storageFreeGb": "number",
    "cpuLoadPercent": "number",
    "memoryUsedPercent": "number"
  },
  "alertFlags": ["LOW_STORAGE | PLAYBACK_ERROR | GPS_LOST | ASSET_CORRUPT"]
}
```

---

### `openad/{deviceId}/impressions`
**QoS**: 2 (exactly-once — mandatory for commercial accountability, FR-021)  
**Trigger**: On each ad play completion  
**Retained**: No

**Payload**
```json
{
  "eventId": "string (UUID v4, device-generated — used for server-side dedup)",
  "ts": "ISO8601 (device local time, pre-validated)",
  "campaignId": "string",
  "scheduleRuleId": "string",
  "assetId": "string",
  "durationPlayedSeconds": "number",
  "location": {
    "lat": "number | null",
    "lng": "number | null",
    "accuracyMeters": "number | null",
    "gpsLocked": "boolean"
  }
}
```

**Notes**:
- If `gpsLocked: false`, both `lat` and `lng` MUST be the last known coordinates (not null). The server sets `locationVerified: false` on the stored `ImpressionEvent` (FR-022).
- The device MUST NOT send duplicate `eventId` values; the server deduplicates by `eventId` unique index.

---

### `openad/{deviceId}/commands/ack`
**QoS**: 1 (at-least-once — server idempotently handles duplicate ACKs)  
**Trigger**: On completion of a received command  
**Retained**: No

**Payload**
```json
{
  "commandId": "string",
  "status": "success | failure",
  "completedAt": "ISO8601",
  "details": "string | null (error message if status = failure)"
}
```

---

## Server → Device Topics

### `openad/{deviceId}/commands`
**QoS**: 1 (at-least-once — device handles per `commandId` idempotency)  
**Trigger**: When a remote command is issued from the dashboard (FR-018, FR-019)  
**Retained**: No

**Payload**
```json
{
  "commandId": "string",
  "type": "RESTART | SYNC_SCHEDULE | CLEAR_CACHE | CUSTOM",
  "issuedAt": "ISO8601",
  "expiresAt": "ISO8601",
  "payload": "object | null"
}
```

**Notes**:
- Device MUST discard commands where `expiresAt < now`.
- Device MUST publish an ACK to `openad/{deviceId}/commands/ack` on every processed command.

---

### `openad/{deviceId}/schedule`
**QoS**: 1 (at-least-once — device applies idempotently by rule version)  
**Trigger**: On campaign activation, rule update, or asset update (FR-008, FR-013)  
**Retained**: Yes (device receives current schedule on reconnect)

**Payload**
```json
{
  "schemaVersion": "number (increment on breaking changes)",
  "generatedAt": "ISO8601",
  "rules": [
    {
      "ruleId": "string",
      "priority": "number",
      "assetId": "string",
      "assetUrl": "string (pre-signed download URL, 24h expiry)",
      "assetChecksumSha256": "string",
      "assetVersion": "number",
      "geoZones": [
        {
          "zoneId": "string",
          "geometry": { "type": "Polygon | Circle", "coordinates": "..." }
        }
      ],
      "timeWindows": [
        {
          "daysOfWeek": ["string"],
          "startTime": "HH:MM",
          "endTime": "HH:MM",
          "timezone": "string"
        }
      ],
      "dwellThresholdSeconds": "number",
      "validUntil": "ISO8601"
    }
  ],
  "fallbackAssetId": "string | null (default content when no rule matches)"
}
```

---

### `openad/fleet/broadcast`
**QoS**: 0  
**Trigger**: System-wide announcements (maintenance windows, emergency stops)  
**Retained**: No

**Payload**
```json
{
  "type": "MAINTENANCE_WINDOW | EMERGENCY_STOP | RESUME | INFO",
  "message": "string",
  "effectiveAt": "ISO8601",
  "expiresAt": "ISO8601 | null"
}
```

---

## Error Handling

- If a device receives a `schedule` message with an `assetUrl` it cannot download, it falls back to the cached previous version of that asset and sets `alertFlags: ['ASSET_CORRUPT']` in the next telemetry message.
- If a device cannot process a command (e.g., RESTART while an impression event is in-flight), it queues the command internally and processes it after the impression ACK is sent.
- If the MQTT broker connection is lost, the device enters offline mode using its local schedule snapshot. It buffers impression events locally and re-delivers them at QoS 2 on reconnect.
