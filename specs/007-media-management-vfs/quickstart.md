# Quickstart: Media Management Module (local dev)

**Audience**: Developers implementing the explorer UI, upload flow, and API in OpenAD.

## Prerequisites

- Node.js 20+, pnpm (per monorepo), Nx CLI via `pnpm exec nx`
- MongoDB reachable from `app/openad-api` (see `.env` / `.env.dev`)
- S3-compatible bucket + credentials for presigned URL tests (production: AWS S3; local: **MinIO** from root `docker-compose.yml`)

## Run API

From repo root:

```bash
pnpm exec nx serve openad-api
```

Ensure environment includes: MongoDB URI, S3 bucket/region/credentials, JWT/auth secrets used by existing guards.

## Run management UI

```bash
pnpm exec nx serve openad-management
```

Set `API_BASE_URL` / `PUBLIC_API_BASE_URL` as required by `ngx-env` in `app/openad-management/project.json`.

## Typical dev loop

1. **Seed or migrate** system folders: `/Root/Defaults/Global_Ads`, `/Root/Defaults/System_Assets`, `/Root/Campaigns` with `is_system_locked: true` (script or startup hook — implement per tasks).
2. **Create test campaign** (or emit `CampaignCreated`) and confirm `/Root/Campaigns/{name}` appears in tree API.
3. **Upload**: call **init** → upload parts to presigned URLs → **complete**; verify `media_assets` row and inspector fields in UI.
4. **Soft copy**: clone row to another folder; confirm identical `storage_key` / `file_hash` and reference count in inspector.
5. **Delete**: remove one placement; confirm S3 object remains if another row shares `storage_key`; remove all → object deleted.

## Security verification (manual)

Use two test users or JWTs with access to **different** campaigns:

1. **Read isolation**: `GET /v1/media/assets/:id` and folder children for campaign A’s ids with campaign B’s token MUST return **403** (or **404** if using no-leak policy — be consistent across the API).
2. **Complete isolation**: Attempt `POST .../complete` for another user’s `sessionId` → **403**.
3. **Clone / delete**: Cross-campaign clone/delete without permission → **403**.
4. **GC**: Confirm `DeleteObject` is only invoked for keys under your **tenant prefix** (inspect logs in dev).

## Observability spot-check

- After uploads, confirm logs include terminal state per upload and timing from complete → validation result (supports **SC-001** / **SC-005** / **SC-006**).
- If metrics are enabled, check validation latency histogram in your metrics backend.

## Tests

```bash
pnpm exec nx test openad-api
pnpm exec nx test openad-management
pnpm exec nx test api-contracts
```

## Contract edits

When changing HTTP payloads, update Zod schemas under `libs/api-contracts` and re-export from `src/index.ts`; regenerate OpenAPI if the API project publishes it (`nx run openad-api:openapi` when applicable).
