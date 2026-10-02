# Research: Media Management Module (007)

**Feature**: Media Management VFS + explorer UI + S3 ingestion + soft copy + GC  
**Date**: 2026-04-11

## 1. Frontend shell: three-pane explorer vs. multi-route

**Decision**: Single route owns a **CSS grid/flex** layout: **left** fixed-width tree, **center** fluid explorer, **right** inspector; breakpoints swap to drawer + bottom sheet.

**Rationale**: Matches spec “Google Drive–like” behavior, one URL per “folder context,” shared selection state. Aligns with existing `openad-management` Angular + PrimeNG stack.

**Alternatives considered**: Separate routes for tree vs. content — rejected (harder selection + inspector sync, more navigation churn).

## 2. Tree data: materialized path + single Mongo query

**Decision**: Store **`path`** (or `materializedPath`) on folder documents; fetch subtree with **prefix query** on `path` (indexed) for the navigation tree; alternatively **`ancestors` array** + `$elemMatch` — choose one in implementation; document in [data-model.md](./data-model.md) as indexed path field.

**Rationale**: User requirement: “collapsible tree … single MongoDB path queries”; avoids N+1 per depth for large trees.

**Alternatives considered**: Adjacency list only — rejected for read-heavy tree expansion cost without caching.

## 3. Upload path: presigned multipart direct to S3

**Decision**: **POST** upload session → returns **presigned URLs** (multipart where needed) → client uploads **directly to S3** → **POST complete** registers asset, enqueues metadata extraction.

**Rationale**: Meets “backend never handles binary stream” and scales I/O.

**Alternatives considered**: API streaming proxy — rejected (explicit constraint).

## 4. Client pre-flight vs. server validation

**Decision**: Client checks **extension, max size, basic resolution** from published limits; server remains authoritative for **DOOH rules** and final approval.

**Rationale**: Fast feedback; avoids useless presigns for obviously invalid files; aligns with FR-003/FR-004.

**Alternatives considered**: Server-only validation — rejected (poor UX, wasted round-trips for trivial rejects).

## 5. Soft copy: duplicate `media_assets` rows

**Decision**: **Insert second document** with same **`storage_key`** + **`file_hash`**, different **`folder_id`** / campaign context; tablets resolve **hash** → cache hit.

**Rationale**: Matches user workflow; refcount = `count({ storage_key })` for GC.

**Alternatives considered**: Separate junction table only — possible but diverges from stated “duplicate document” approach; deferred unless refcount queries become hot (index `storage_key`).

## 6. Garbage collection: two-phase refcount

**Decision**: On “delete” from UI: delete **one** `media_assets` doc; async job or inline transaction: **`count` by `storage_key`**; if zero, **delete S3 object** (and optionally mark tombstone).

**Rationale**: Prevents orphaned binaries and broken refs; matches user spec.

**Alternatives considered**: Immediate S3 delete — rejected (breaks other references).

## 7. Mobile: bottom sheet + FAB

**Decision**: Inspector as **PrimeNG Drawer / overlay panel** or **CDK drag** bottom sheet pattern; primary actions on **FAB** (upload / new folder).

**Rationale**: Familiar mobile pattern; keeps parity with desktop actions.

**Alternatives considered**: Full-screen inspector page — acceptable fallback if sheet complexity is too high (YAGNI escape hatch).

## 8. Contract versioning

**Decision**: Extend **`libs/api-contracts`** with new Zod schemas (`media_assets` row DTOs, folder nodes, upload session) and export from package index; follow semantic versioning for breaking field renames.

**Rationale**: Constitution VII + existing `mediaAssetSchema` precedent.

**Alternatives considered**: Ad-hoc API types only in API — rejected (DRY / tablet + web consumers).

## 9. Security & upload integrity (remediation)

**Decision**: **Session-bound presigned uploads** with server-chosen `storage_key` prefix; **`complete`** performs storage verification before catalog insert; **GC** deletes only keys under known prefix; **guards** on all routes from first merge.

**Rationale**: Prevents IDOR-style folder/asset access, phantom catalog rows, and cross-tenant delete mistakes; aligns with constitution security-at-design and **FR-011**.

**Alternatives considered**: Client-trusted complete without verification — rejected.
