# Analytics HTTP surface (006)

**Audience**: API consumers and integrators  
**Scope**: Device ingest, management reporting, and pacing read APIs under `/api/v1`.

## Versioning

> **Corrigido em 2026-10-03 (P8).** A versão independente do segmento `analytics/v1/` foi
> removida. Sob o prefixo global `api/v1`, ela produzia `/api/v1/analytics/v1/campaigns` — a
> versão duas vezes, uma delas sem significado. A política abaixo nunca se concretizou: não
> existe `analytics/v2`, nenhuma outra área da API tem versão própria, e os serviços irmãos do
> ecossistema (`hub`, `opendriver`) usam um prefixo só. O caminho agora é
> `/api/v1/analytics/campaigns/...`.
>
> Mudança incompatível em analytics passa a seguir a regra do resto da API: versão nova no
> prefixo global, com janela de depreciação documentada.

- A superfície é versionada **apenas** pelo prefixo global `api/v1`.
- Adição não incompatível (campo opcional, parâmetro de consulta opcional) não exige versão
  nova.

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/devices/:deviceId/analytics/play-batches` | Device JWT (`Bearer`) | Accept JSON or gzip batch of play records; validate and enqueue reconciliation (202). |
| GET | `/analytics/campaigns/:campaignId/reporting/summary` | User JWT + roles | Campaign impressions, reach, revenue for `from` / `to` (ISO-8601). Valores monetários em centavos inteiros. |
| GET | `/analytics/campaigns/:campaignId/pacing` | User JWT + roles | Daily pacing snapshot (UTC day): spend vs budget and `pacingState`. |

**Roles** (reporting / pacing): `fleet_operator`, `fleet_admin`, `super_admin`, `finance_analyst`.

## Request limits

- Batch body size is capped by **`ANALYTICS_PLAY_BATCH_MAX_BYTES`** (see server env validation). Gzip ingest requires raw body capture in Nest bootstrap.

## Contract detail

- Play record and batch envelope shapes: `libs/api-contracts` — see `playback-play-record.md` in this folder.
