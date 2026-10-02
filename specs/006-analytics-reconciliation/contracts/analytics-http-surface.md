# Analytics HTTP surface (006)

**Audience**: API consumers and integrators  
**Scope**: Device ingest, management reporting, and pacing read APIs under `/api/v1`.

## Versioning

- Reporting and pacing routes use the **`analytics/v1/`** path segment. Increment this segment when response shapes or query contracts change in a breaking way.
- **Semver policy**: Treat `analytics/v1/*` as a stable public surface for management clients. Breaking changes require a new version segment (`analytics/v2/…`) and a deprecation window documented in release notes. Non-breaking additions (optional fields, new optional query params) do not require a version bump.

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/devices/:deviceId/analytics/play-batches` | Device JWT (`Bearer`) | Accept JSON or gzip batch of play records; validate and enqueue reconciliation (202). |
| GET | `/analytics/v1/campaigns/:campaignId/reporting/summary` | User JWT + roles | Campaign impressions, reach, revenue for `from` / `to` (ISO-8601). |
| GET | `/analytics/v1/campaigns/:campaignId/pacing` | User JWT + roles | Daily pacing snapshot (UTC day): spend vs budget and `pacingState`. |

**Roles** (reporting / pacing): `fleet_operator`, `fleet_admin`, `super_admin`, `finance_analyst`.

## Request limits

- Batch body size is capped by **`ANALYTICS_PLAY_BATCH_MAX_BYTES`** (see server env validation). Gzip ingest requires raw body capture in Nest bootstrap.

## Contract detail

- Play record and batch envelope shapes: `libs/api-contracts` — see `playback-play-record.md` in this folder.
