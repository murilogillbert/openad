# API & Integration Contracts: Media Management (007)

This folder summarizes **external** interfaces for the Media Management module. Canonical request/response schemas SHOULD live in **`libs/api-contracts`** as Zod definitions (same pattern as `media-asset.contract.ts`).

## Trust boundaries (presigned upload)

- **`POST /v1/media/uploads`**: Server creates a **durable upload session** and returns presigned URL(s) only for the **server-chosen** `storage_key` (under tenant prefix), plus `sessionId`, declared **max bytes**, and **allowed MIME types**. Clients MUST NOT supply arbitrary bucket keys.
- **`POST /v1/media/uploads/:sessionId/complete`**: Server verifies the object exists in storage and matches session constraints (size, and optionally ETag/checksum) **before** inserting `media_assets`. Failed verification returns **4xx** with no catalog row (**FR-011**).
- **Authorization**: All folder and asset IDs are resolved against the caller’s permitted campaigns; mutations return **403** when out of scope (**SC-004**).

## REST (management UI ↔ openad-api)

| Concern | Method / path (illustrative) | Purpose |
|---------|------------------------------|---------|
| Folder tree | `GET /v1/media/folders/tree` | Collapsible tree: roots + children or subtree by `materialized_path` prefix |
| Folder children | `GET /v1/media/folders/:folderId/children` | Explorer listing (files + subfolders); optional `q` query for search |
| Create folder | `POST /v1/media/folders` | New folder under parent (respect locks) |
| Rename / move folder | `PATCH /v1/media/folders/:id` | Rename or reparent where permitted |
| Move / rename asset | `PATCH /v1/media/assets/:id` | Body includes target `folder_id` and/or `filename` — must validate destination folder scope |
| Upload init | `POST /v1/media/uploads` | Returns presigned URL(s), `storage_key`, `sessionId`, limits |
| Upload complete | `POST /v1/media/uploads/:sessionId/complete` | Verifies object, registers `media_assets`, enqueues probe/validation |
| Upload abort (optional) | `POST /v1/media/uploads/:sessionId/abort` | Marks session aborted; optional multipart cleanup |
| Asset detail | `GET /v1/media/assets/:id` | Inspector: specs, hash, **referenceCount** (count by `storage_key`) |
| Soft delete asset | `DELETE /v1/media/assets/:id` | Removes catalog row; triggers orphan GC |
| Soft copy | `POST /v1/media/assets/:id/clone` | New row, same `storage_key` / `file_hash`, target `folder_id` |

**Versioning**: Prefix with `/v1/`; breaking changes require MAJOR bump per constitution.

## Events (async)

| Event | Producer | Consumer behavior |
|-------|----------|-------------------|
| `CampaignCreated` | Campaigns domain | Upsert `/Root/Campaigns/{name}`, set `campaign_id` |
| `CampaignRenamed` | Campaigns domain | Update folder name + subtree `materialized_path` |
| `MediaAssetRegistered` / `UploadCompleted` | Media module | Workers: FFmpeg probe, DOOH validation |
| `DoohRulesetPublished` (optional) | Config / admin | Triggers re-validation or flagging per **FR-010** |

## Tablet / manifest alignment

Tablet playback continues to use **`file_hash`** (and existing manifest contracts) for **deduplication**; soft-copy rows MUST preserve the same hash as the canonical upload.

## Next step

Implement concrete Zod types in `libs/api-contracts/src/media/` (e.g. `media-vfs.contract.ts`) and wire Nest DTOs + OpenAPI generation to match.
