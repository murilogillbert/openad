# Research: Tablet Ops Pipeline

**Feature**: 003-tablet-ops-pipeline  
**Date**: 2026-04-05  
**Source**: Technical unknowns from `plan.md` and requirements in `spec.md`

---

## 1. Pairing secret storage and display

**Decision**: Store only a **cryptographic hash** of the high-entropy secret (e.g. Argon2id or bcrypt with work factor appropriate for server-side verification). Generate a separate **short display code** (≤ 8 alphanumeric characters) mapped to the same pairing request row for admin UX, or derive display via keyed encoding from the secret id — **never** store the raw secret in MongoDB.

**Rationale**: FR-002 and acceptance scenarios require plaintext not stored; single-use and TTL remain enforceable by comparing hash at binding time.

**Alternatives considered**: Plaintext in Redis with TTL (rejected — adds infra dependency and duplicate source of truth); encrypting secret in DB (rejected — still requires careful key management; hash + OOB display is simpler).

---

## 2. Device JWT and hardware fingerprint

**Decision**: Issue device JWT with claims: `sub` = `deviceId`, `typ` = `device`, and **`fp`** = SHA-256 of canonicalised fingerprint tuple (IMEI + serial + MAC). On each authenticated request, recompute fingerprint from request headers/body per contract and compare to `fp`; mismatch → **403 Hardware Mismatch** with audit log.

**Rationale**: FR-003, FR-004, FR-006 align with stateless JWT validation plus explicit fingerprint check without storing full PII in logs (log hash only).

**Alternatives considered**: Session-only tokens in Redis (rejected — scales with fleet but violates KISS vs existing JWT); per-request DB lookup of stored fingerprint (rejected — extra read; acceptable as fallback if claims too large — **not** needed if claim is hash only).

---

## 3. Screenshot upload (`GET_SCREENSHOT`)

**Decision**: API returns command payload including **presigned PUT URL** (and expiry) for object storage; tablet captures frame, uploads with `Content-Type` image/jpeg or png, then acknowledges via MQTT. API validates object exists or uses callback webhook optional phase-2.

**Rationale**: FR-013 and spec edge cases (upload failure → `Acknowledged_Failure` after 60 s) match direct-to-storage pattern already assumed in spec.

**Alternatives considered**: Multipart via API (rejected — bandwidth and memory on API nodes); base64 in MQTT (rejected — payload size limits).

---

## 4. Command persistence and offline delivery

**Decision**: **MongoDB** as authoritative queue: `remote_commands` with TTL index on `expiresAt`. Dispatcher publishes to MQTT `openad/{id}/commands` with QoS 1; tablet acks on `.../commands/ack`. On reconnect, **retained message** or **replay**: either retain last command per topic (limited) or tablet calls `GET /devices/{id}/commands/pending` on connect — prefer **DB + dispatcher** as source of truth with MQTT as transport (matches FR-011).

**Rationale**: Survives broker restarts; audit trail in DB matches FR-010.

**Alternatives considered**: MQTT broker persistence only (rejected — harder to query lifecycle in admin panel); Redis queue (rejected — YAGNI unless Mongo proves slow).

---

## 5. Manifest delta algorithm

**Decision**: Per-device **`lastManifestVersion`** (monotonic integer or content hash) stored server-side. API returns `{ version, added: AssetRef[], removed: assetId[] }`. Tablet applies diff: delete local files for `removed`, download `added` only.

**Rationale**: FR-022–FR-023; SC-009 measurable.

**Alternatives considered**: Full manifest always (rejected — violates FR-022); operational transform (rejected — YAGNI).

---

## 6. Sync windows (client)

**Decision**: Rules delivered on `devices/{id}/config` (retained) as JSON: `syncWindows: [{ startTime, endTime, daysOfWeek, sizeThresholdMb }]`. Download scheduler **queues** when current local time outside window and asset size exceeds the threshold; **Emergency Sync** flag in command payload or one-shot config bypasses queue.

**Rationale**: FR-024–FR-027, FR-028; aligns with spec 002 config propagation pattern.

**Alternatives considered**: Polling-only (rejected — FR-026 requires push within 60 s).

---

## 7. Android identifiers and permissions

**Decision**: Use **Android 10+** APIs: `Build.getSerial()` where permitted, `TelephonyManager.getImei()` with `READ_PHONE_STATE`, MAC via `NetworkInterface` / WifiInfo as available; if any required field missing, return **FINGERPRINT_UNAVAILABLE** per edge case.

**Rationale**: Spec assumption Android 10+; edge case documented in spec.

**Alternatives considered**: Advertising ID (rejected — not hardware-bound).

---

## 8. Watchdog timing (3 AM restart, 24 h safety loop)

**Decision**: **Local timezone** `Intl` or device clock; 24 h manifest failure tracked by timestamp of last successful manifest fetch in tablet storage. Deep Sleep defers 3 AM restart per spec.

**Rationale**: FR-015–FR-021; explicit edge cases in spec.

**Alternatives considered**: Server UTC only (rejected — spec mandates local 3 AM).
