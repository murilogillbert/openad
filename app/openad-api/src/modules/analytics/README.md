# Analytics module

Play batch ingest, reconciliation, fraud signals, reporting aggregation, and daily pacing. Queue: `analytics-reconciliation` (BullMQ).

## HTTP surface

See `specs/006-analytics-reconciliation/contracts/analytics-http-surface.md` for paths, auth, and semver notes. Controllers in this folder expose Swagger tags `analytics`, `reporting`, and `pacing` where applicable.

## Environment

Runtime thresholds are read from the Platform Configuration document (Mongo) via `PlatformConfigRuntimeService` (with safe defaults).

## Load testing

For SC-005 ingest-only concurrency checks, use `tools/analytics-ingest-load/` (see `specs/006-analytics-reconciliation/quickstart.md`).
