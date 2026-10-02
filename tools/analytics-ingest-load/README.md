# Analytics ingest load (SC-005)

Stress **ingest receipt only** (HTTP accept + enqueue): many concurrent POSTs of small JSON batches with a device JWT.

## Prerequisites

- API running (`pnpm exec nx run openad-api:serve`).
- A paired device JWT for `BASE_URL` + `DEVICE_JWT` (same as integration tests: seed device + `signDeviceAccessToken` or real pairing).

## Run

```bash
export BASE_URL=http://127.0.0.1:3000
export DEVICE_ID=<uuid>
export DEVICE_JWT=<device access token>
export CONCURRENCY=40
export REQUESTS=200
node tools/analytics-ingest-load/run.mjs
```

Exit code 0 if all requests return HTTP 202. Tune `CONCURRENCY` / `REQUESTS` toward your SC-005 / `plan.md` goals without overwhelming workers.
