# Quickstart: Analytics & Reconciliation Engine

**Feature**: `006-analytics-reconciliation` | **Audience**: Developers

## Prerequisites

- Monorepo bootstrapped (Node 20, pnpm, Docker) per root `README.md`
- Stack running: `pnpm docker:up` — MongoDB, Redis, RabbitMQ (MQTT), as needed
- Prior features: device pairing, manifest sync, playback (005 geospatial optional for geofence verification)

## Local flow

1. **API**: `pnpm exec nx run openad-api:serve` — health at `http://localhost:3000/api/health`.

2. **Redis**: Required for BullMQ workers — same Redis as existing queues.

3. **Ingest smoke** (after implementation): POST a gzipped batch of play records with device JWT; verify job queued and documents in `play_records`.

4. **Tablet**: `pnpm exec nx run openad-ad-client:serve` — enable SQLite plugin; simulate plays → buffer → flush when “online.”

5. **Reporting**: Query management API or Mongo directly for `billable` counts vs test fixtures.

## Testing

- `pnpm exec nx run openad-api:test --testPathPattern=analytics` (once module exists)
- `pnpm exec nx run openad-ad-client:test --testPathPattern=play-record`

## Performance notes

- Keep ingest handler to **validate + enqueue** only; load-test workers separately.
- **Concurrent ingest (SC-005)**: `tools/analytics-ingest-load/` — see `tools/analytics-ingest-load/README.md` (requires `DEVICE_ID` + `DEVICE_JWT`).
- Index review after first 1M plays sample.

## Integration tests & Redis

- Fraud rules read `stream:telemetry` for heartbeat density. Tests that expect `billable` after reconciliation seed at least one stream entry for the device in the play time window (see `analytics-playback-batch-ingest.integration.spec.ts`).
