# Quickstart: Geospatial Intelligence & Triggering Engine

**Feature**: `005-geospatial-triggering-engine` | **Audience**: Developers implementing the plan

## Prerequisites

- Monorepo bootstrapped per root `README.md` (Node 20, pnpm, Docker for MongoDB/Redis/MQTT)
- Completed or merged **004-media-orchestration-pipeline** baseline (manifest sync, playback, telemetry plumbing)

## Local development flow

1. **Start infrastructure**: `pnpm docker:up` from repo root (MongoDB, Redis, RabbitMQ MQTT, MinIO as needed).

2. **API**: `pnpm exec nx run openad-api:serve` — verify health at `http://localhost:3000/api/health`.

3. **Seed or create spatial zones** (once management UI + API exist): define at least one circle and one polygon zone with different tiers attached to test media IDs.

4. **Request manifest** from a paired device JWT (see `004` integration tests): confirm response includes `spatial.entries[]` with expected geometry and trigger metadata.

5. **Tablet client**: `pnpm exec nx run openad-ad-client:serve` or run on Android after `nx run openad-ad-client:cap-sync`; enable location permissions; use replayed GPS trace or field test to validate entry vs dwell and cooldown logs.

6. **Verify telemetry**: subscribe to fleet MQTT topics (or inspect ingested MongoDB collections) for `spatial.receipt`, `spatial.lost_opportunity`, and residency batches.

## Testing strategy (TDD)

- **API**: Unit tests for circle/polygon evaluation, tier ordering, manifest serialization; integration tests for manifest endpoint with spatial payload.
- **Tablet**: Unit tests for state machine (entry/dwell/hysteresis), scoring, rotation, shadow queue; Vitest + replayed coordinate arrays.
- **Contracts**: Zod round-trip tests in `libs/api-contracts` / `libs/mqtt-contracts`.

## Performance checks

- Manifest generation with spatial section remains within existing **&lt;200ms** target for typical catalog sizes; profile before adding heavy polygon sets.
- Tablet geofence loop should run on **smoothed** coordinates at configurable interval without blocking UI thread (Web Worker or async scheduling if needed).
