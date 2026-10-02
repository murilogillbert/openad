# MQTT Contracts: Tablet Ops Pipeline

**Feature**: 003-tablet-ops-pipeline  
**Library**: `libs/mqtt-contracts/src/lib/schemas.ts` (Zod)  
**Existing topics**: See `app/openad-ad-client/src/app/services/mqtt-topics.ts`

---

## Topic summary

| Direction | Topic pattern | QoS | Retained |
|-----------|---------------|-----|----------|
| Server → device | `devices/{deviceId}/config` | 1 | yes |
| Server → device | `openad/{deviceId}/schedule` | 1 | yes |
| Server → device | `openad/{deviceId}/commands` | 1 | no* |
| Device → server | `openad/{deviceId}/commands/ack` | 1 | no |
| Device → server | `devices/{deviceId}/heartbeat` | 0/1 | no |

\*Retained policy: prefer **non-retained** per-command messages; persistence is **database-backed** (see `research.md`). If broker retention is used for last command only, document broker-specific limits.

---

## 1. Extend `serverCommandPayloadSchema`

**Current** (abridged): `type` ∈ `RESTART` | `SYNC_SCHEDULE` | `CLEAR_CACHE` | `CUSTOM`.

**Add** command types:

- `GET_SCREENSHOT`
- `UPGRADE_APP`
- `SET_VOLUME`
- `SET_BRIGHTNESS`
- `EMERGENCY_SYNC`

**Proposed shape** (discriminated by `type`):

```typescript
// Conceptual — implement as z.discriminatedUnion in mqtt-contracts
type ServerCommandPayload =
  | {
      commandId: string;
      type: 'GET_SCREENSHOT';
      issuedAt: string;
      expiresAt: string;
      payload: {
        uploadUrl: string;
        uploadHeaders?: Record<string, string>;
        deadlineAt: string; // ISO — align with 60s requirement
      };
    }
  | {
      commandId: string;
      type: 'CLEAR_CACHE';
      issuedAt: string;
      expiresAt: string;
      payload: null;
    }
  | {
      commandId: string;
      type: 'UPGRADE_APP';
      issuedAt: string;
      expiresAt: string;
      payload: { apkUrl: string; checksumSha256?: string };
    }
  | {
      commandId: string;
      type: 'SET_VOLUME' | 'SET_BRIGHTNESS';
      issuedAt: string;
      expiresAt: string;
      payload: { level: number }; // 0–100
    }
  | {
      commandId: string;
      type: 'EMERGENCY_SYNC';
      issuedAt: string;
      expiresAt: string;
      payload: { manifestUrl?: string } | null;
    };
```

Backward compatibility: keep existing enum values; add new literals in the same `type` field or migrate to discriminated union in one PR with tablet + API lockstep.

---

## 2. Extend `commandAckPayloadSchema`

**Current**: `status`: `success` | `failure`.

**Add** optional fields for Fleet Monitor:

```typescript
interface CommandAckPayload {
  commandId: string;
  status: 'success' | 'failure';
  completedAt: string;
  details: string | null;
  /** Optional fine-grained outcome for screenshot / upgrade */
  resultCode?: 'OK' | 'TIMEOUT' | 'UPLOAD_FAILED' | 'DOWNLOAD_FAILED' | 'INSTALL_FAILED';
}
```

---

## 3. Device config — sync windows + manifest pointer

Payload on `devices/{deviceId}/config` MUST include (additive):

```typescript
interface DeviceConfigExtensions {
  syncWindows?: Array<{
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    sizeThresholdMb: number;
  }>;
  /** Bumped when sync rules change — tablet may compare to last applied */
  configRevision?: number;
}
```

Merge with existing `DeviceConfigPayload` in tablet code — single retained message per device.

---

## 4. Heartbeat — sleep / safety loop (optional extension)

If not already in telemetry/heartbeat payload, extend **heartbeat** JSON to include:

```typescript
watchdogState?: 'normal' | 'deep_sleep' | 'safety_loop';
lastManifestFetchAt?: string | null;
```

So Fleet Monitor can show operational mode without polling REST.

---

## 5. Testing

- Unit tests: Zod parse success/failure for every new `type` variant.
- Integration: `CommandDispatchProcessor` publishes payload that round-trips through `serverCommandPayloadSchema.parse`.
