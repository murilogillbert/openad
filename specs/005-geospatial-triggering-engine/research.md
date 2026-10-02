# Phase 0 Research: Geospatial Intelligence & Triggering Engine

**Feature**: `005-geospatial-triggering-engine` | **Date**: 2026-04-05

## 1. Geometry representation (circle + polygon)

**Decision**: Represent zones in a single transport shape discriminant:

- **Polygon**: GeoJSON `Polygon` outer ring (lng/lat), validated server-side (closed ring, minimum vertices). Evaluation uses existing point-in-polygon approach (Turf or equivalent).
- **Circle**: Center `[lng, lat]` + `radiusMeters` (WGS84). “Inside” = haversine distance from center ≤ radius. Avoid misusing GeoJSON `Point` alone without radius.

**Rationale**: Matches FR-001; circles are compact; polygons cover corridors. No need for full GIS suite for v1.

**Alternatives considered**: GeoJSON `buffer` of a point (heavier); storing only polygons approximating circles (worse UX for operators).

---

## 2. Server vs tablet responsibility split

**Decision**:

- **Server**: Authoritative zone definitions, tier/priority, campaign pacing hints, manifest packaging, version stamps, ledger ingestion APIs.
- **Tablet**: Continuous location pipeline (adaptive sampling, smoothing, dead reckoning), zone membership, entry/dwell state machine, tier filter → within-tier score → rotation, loop locking, shadow queue, cooldown store, suppression telemetry upload.

**Rationale**: FR-004 requires local evaluation without per-fix server round-trip.

**Alternatives considered**: Server-side geofencing only (rejected: violates FR-004 and battery goals).

---

## 3. Manifest integration

**Decision**: Extend the **device manifest** (or a dedicated sub-document delivered in the same sync transaction) with a **`spatial`** (or `geo`) section containing:

- Version string for cache invalidation
- List of **spatial entries**: `{ zoneId, geometry (circle|polygon), tier, priorityScore, mediaId(s), trigger { entry|dwell, dwellSec }, arbitration { weights… }, rotation, epicenter for distance score, velocity gates }`

Reuse existing manifest sync/delta where possible; additive JSON fields to avoid breaking legacy clients (feature flag or min client version).

**Rationale**: Single sync path already proven in 004; operators need one publish pipeline.

**Alternatives considered**: Separate REST pull for spatial JSON only (extra failure mode); MQTT-only spatial (rejected: must work offline after sync).

---

## 4. Smoothing & dead reckoning

**Decision**:

- **Smoothing**: Sliding window (last *N* fixes, configurable *N* default 5) with simple moving average on lat/lng **or** complementary filter lite; document accuracy tradeoff. Goal: meet SC-001 style false-crossing reduction without claiming a specific filter in the spec.
- **Dead reckoning**: Extrapolate using last speed + heading for max *T* seconds or until horizontal accuracy exceeds threshold; pause triggers when uncertainty too high.

**Rationale**: FR-008/FR-009; aligns with assumptions in spec.

**Alternatives considered**: Full Kalman + IMU fusion (YAGNI for v1 without hardware guarantees).

---

## 5. Ledger & analytics transport

**Decision**:

- **Spatial receipts** and **lost-opportunity** events sent via existing **fleet telemetry / MQTT** topic family (batched, at least end-of-play) with idempotent keys.
- **Residency**: Aggregated **on tablet** into interval records (zoneId, start, end, optional distance band) uploaded periodically or on zone exit; server stores time-series friendly documents in MongoDB for reporting.

**Rationale**: Reuses connectivity patterns; avoids new long-polling API during drive.

**Alternatives considered**: HTTP-only posts per event (high churn on poor networks).

---

## 6. Tier & scoring implementation order

**Decision**: Implement **tier gating first** (strict ordering FR-016), then **within-tier score** (FR-019), then **rotation** (FR-006). **Shadow queue** (FR-018) after core arbitration stable.

**Rationale**: Delivers correct “winner class” before tuning weights; reduces debug surface.

---

## 7. Management UI scope

**Decision**: Extend **openad-management** with zone CRUD (circle + polygon map), tier assignment, weights, dwell/cooldown/hysteresis meters — phased: read-only map + polygon vertices in v1 if needed.

**Rationale**: FR-020 requires configuration surface; exact UX can follow campaign/geo-zone patterns already in repo.

---

## Open items (none blocking plan)

All former “unknowns” resolved above; no `NEEDS CLARIFICATION` remains for Phase 1 design.
