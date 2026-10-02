# Data Model: Media Management Module

**Date**: 2026-04-11  
**Stores**: MongoDB (documents below), S3 (bytes addressed by `storage_key`)

## Conventions

- **IDs**: `ObjectId` or UUID string — align with existing OpenAD conventions; external API exposes string IDs.
- **Immutability**: `storage_key` and `file_hash` set at registration; soft-copy rows **share** both.
- **Storage key namespace**: `storage_key` values MUST begin with a tenant- or org-specific prefix issued by the API so garbage collection and accidental key collision across tenants are prevented (**defense in depth** with bucket policy where applicable).

---

## Entity: `folder_nodes` (collection name TBD in implementation)

Logical VFS folder; materialized tree for path queries.

| Field | Type | Notes |
|-------|------|--------|
| `_id` | ObjectId | Primary key |
| `name` | string | Display name; uniqueness scoped by parent |
| `parent_id` | ObjectId \| null | `null` only for true root if modeled |
| `materialized_path` | string | e.g. `/Root/Campaigns/Acme_Q4`; **indexed** for prefix queries |
| `campaign_id` | UUID \| null | Set under `/Root/Campaigns/{...}` |
| `is_system_locked` | boolean | `true` for `/Root/Defaults/...`, `/Root/Campaigns` skeleton nodes |
| `created_at` / `updated_at` | ISO datetime | Audit |

**Relationships**

- Parent/child via `parent_id` + optional `children_count` denormalization.
- Campaign rename: update `name` + recompute `materialized_path` for subtree (async worker).

**Validation**

- `materialized_path` must start with `/Root`; system paths created only by provisioning service.
- No delete/move that violates `is_system_locked` for protected nodes.

---

## Entity: `media_assets` (catalog rows; soft-copy = multiple docs)

Each row is a **placement** in the VFS; same **binary** can back multiple rows.

| Field | Type | Notes |
|-------|------|--------|
| `_id` | ObjectId | Primary key |
| `folder_id` | ObjectId | Placement folder |
| `campaign_id` | UUID | Denormalized for permission filters |
| `storage_key` | string | S3 object key; **indexed**; shared across soft copies |
| `file_hash` | string | Content hash (e.g. SHA-256 hex); matches tablet manifest dedup |
| `filename` | string | Display name in folder |
| `mime_type` | string | e.g. `video/mp4`, `image/jpeg` |
| `byte_size` | int64 | |
| `width` / `height` | int | Optional until probe completes |
| `duration_sec` | number | Video/audio |
| `validation_status` | enum | e.g. `pending`, `approved`, `rejected`, `warning` |
| `validation_detail` | object \| string | Rule failures |
| `dooh_ruleset_version` | string \| null | Optional tag of the rule set used for last meaningful validation (supports re-validation policy) |
| `probe_status` | enum | `pending`, `complete`, `failed` |
| `upload_session_id` | UUID \| null | Correlation to presigned flow (**FR-009**) |
| `initiated_by_user_id` | string \| null | When available from auth (**FR-009**) |
| `soft_deleted_at` | datetime \| null | If using virtual delete with tombstone (optional; else hard delete row) |
| `created_at` / `updated_at` | ISO datetime | |

**Soft copy**

- **Clone** row: new `_id`, new `folder_id` / `campaign_id`, **same** `storage_key`, **same** `file_hash`.

**Reference / GC**

- **Physical refcount** = `count({ storage_key })` across active (non-deleted) rows.
- After deleting one row, if count **0**, enqueue **S3 DeleteObject** for `storage_key`.

---

## Entity: `upload_sessions` (recommended for secure presigned flow)

Tracks multipart presigned upload until completion; binds **who** may call **complete** and **which key** is valid.

| Field | Type | Notes |
|-------|------|--------|
| `_id` | UUID | Session id returned to client |
| `storage_key` | string | Reserved key under tenant prefix |
| `tenant_key_prefix` | string | Must match leading segment of `storage_key` |
| `initiated_by` | user id | Required where auth exists |
| `allowed_campaign_ids` | UUID[] \| null | Scopes placement targets for complete |
| `max_bytes` | int64 | Enforced again at complete |
| `allowed_mime_types` | string[] | Enforced at complete |
| `expires_at` | datetime | Short TTL for presign |
| `status` | enum | `initiated`, `completed`, `aborted`, `expired` |

---

## Events (integration)

| Event | Action |
|-------|--------|
| `CampaignCreated` | Upsert `/Root/Campaigns/{Campaign_Name}`, link `campaign_id` |
| `CampaignRenamed` | Worker updates folder `name` + child `materialized_path` |
| `CampaignDeleted` | Policy: archive or cascade (product decision; default: block if media exists) |

---

## State transitions: `media_assets.validation_status`

```
pending → approved | rejected | warning
```

Server worker (FFmpeg/metadata) and DOOH rule engine drive transitions from `pending` after S3 upload completes.

---

## Indexes (recommended)

- `folder_nodes.materialized_path` (prefix)
- `media_assets.storage_key`
- `media_assets.folder_id` + `campaign_id` (explorer queries)
- `media_assets.file_hash` (optional dedup on ingest)
