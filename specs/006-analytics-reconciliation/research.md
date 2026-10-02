# Phase 0 Research: Analytics & Reconciliation Engine

**Feature**: `006-analytics-reconciliation` | **Date**: 2026-04-05

## 1. Async buffer: BullMQ vs RabbitMQ AMQP

**Decision**: Use **BullMQ** (Redis-backed) for the post-ingest **reconciliation pipeline**, registered in existing `QueuesModule`, following patterns used elsewhere (e.g., command dispatch).

**Rationale**: Stack already runs Redis + BullMQ; no new operational moving part. HTTP handler enqueues a job with batch payload reference or inline small batches; workers scale horizontally.

**Alternatives considered**: Dedicated RabbitMQ **classic queue** for analytics only — valid if strict AMQP semantics or non-Node consumers are required; adds operational surface when MQTT already uses Rabbit for broker duties.

---

## 2. Analytical store: MongoDB vs time-series DB

**Decision**: **MongoDB** for v1 **play record** documents with **compound indexes** on time, campaign, device, and **`uniqueEventId`** (see `data-model.md`). Use **aggregation pipeline** for impressions, reach (distinct `vehicleId`), and daily spend rollups.

**Rationale**: Matches existing OpenAD persistence; meets SC until proven otherwise.

**Alternatives considered**: **TimescaleDB** / **ClickHouse** for heavy OLAP — defer per YAGNI; introduce when query latency or cardinality exceeds Mongo comfort (document threshold in runbooks).

---

## 3. Edge local storage

**Decision**: **SQLite** via Capacitor community plugin (or equivalent maintained SQLite binding) for a **`pending_plays`** table and **`upload_batches`** state (retry count, last error).

**Rationale**: Durable across process kill; supports 50–100 row batches; familiar SQL semantics.

**Alternatives considered**: IndexedDB only — weaker transactional guarantees for crash mid-write; **Filesystem JSON append** — possible but harder to query pending count.

---

## 4. Batch transport: compression

**Decision**: **gzip** body (`Content-Encoding: gzip` or raw binary upload with `application/gzip`) for batch POST; server decompresses before Zod parse.

**Rationale**: Spec calls for cellular efficiency; gzip universally supported.

**Alternatives considered**: Brotli — better ratio but weaker support on some stacks; defer.

---

## 5. Unique event identity

**Decision**: Tablet generates a **UUID v4 per play** stored as **`uniqueEventId`** in core (idempotency key with `deviceId`); deterministic hashing was considered but **UUID per play** is simplest for collision avoidance. Store also **`batchId`** / client batch correlation for idempotent batch retries (see `data-model.md`).

**Rationale**: FR-006 dedupe; UUID avoids hashing contract debates.

**Alternatives considered**: ULID — time-sortable; nice for indexes; optional upgrade.

---

## 6. Geofence verification server-side

**Decision**: Reuse **authoritative zone geometry** from **geo-zones / spatial manifest** services: load zone by `zoneId` at reconciliation time; point-in-polygon / circle test for `lat_start/lng_start` (and optionally end) when trigger is geofence-related.

**Rationale**: Single source of truth with 005.

---

## 7. Pacing signal to manifest

**Decision**: **PacingSignalService** writes **campaign-level** flags (e.g., `pacingPressure: 'reduce'`) consumed by **manifest generator** or **schedule push** on next device sync — either Mongo field on `Campaign` or Redis cache with TTL until midnight campaign TZ.

**Rationale**: FR-012 requires downstream priority change; reuse existing sync channels.

---

## 8. Fraud thresholds

**Decision**: Configurable constants (env or DB): **max implied km/h** from start/end GPS over play duration; **min heartbeats per hour** vs plays ratio; **blackout** discard when `display_lux` below floor if present.

**Rationale**: SC-004 requires no silent pass-through of fraud scenarios.

---

## 9. Implementation order (recommended)

1. Contracts + Mongo schema + ingest enqueue path (no fraud)  
2. Reconciliation: dedupe + duration + geofence  
3. Reporting APIs: impressions + reach  
4. Fraud + heartbeat cross-reference  
5. Pacing + management surfaces  
