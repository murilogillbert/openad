# Quickstart: Vehicle lifecycle and device binding (008)

**Branch**: `008-vehicle-device-lifecycle`

## Prerequisites

- Node.js 20 LTS, repo dependencies installed (`npm install` at monorepo root).
- MongoDB available: set `MONGO_URI` for the API (see `app/openad-api` env validation).
- Redis for API queues/caching: `REDIS_URL` (or `REDIS_TEST_URI` in tests); default `redis://127.0.0.1:6379` when unset.
- JWT credentials for a user with `fleet_admin` or `fleet_operator` (see `app/openad-api` auth seed).
- Management app points at the API via `environment.apiBaseUrl` (see `app/openad-management/src/environments/`).

## Verify API

From repo root (adjust project name if different):

```bash
pnpm exec nx run openad-api:serve
```

Smoke checks after implementation:

- `GET /api/v1/vehicles` — roster includes `bindingStatus` / `pairedDeviceIds` (and related fields) per contracts.
- `GET /api/v1/vehicles/:vehicleId/binding-audit` — paginated **binding lifecycle** events (pair / unpair / decommission) for operator review (FR-011).
- `GET /api/v1/devices` — paginated operator **device inventory** (tablet list for **Devices** tab); includes identity, lifecycle, `lastSeen`, bound `vehicleId` / plate summary as designed.
- `POST /api/v1/vehicles/:vehicleId/pair` — body `{ "deviceId": "<uuid>" }`.
- `POST /api/v1/vehicles/:vehicleId/unpair` — body `{ "deviceId": "<uuid>" }`.
- `DELETE /api/v1/vehicles/:vehicleId` — soft decommission per spec; all paired devices unpaired; audit written; remote cache command as implemented.

## Management UI routes (`openad-management`)

Serve the admin app:

```bash
pnpm exec nx run openad-management:serve
```

**Route map** (aligned with [plan.md](./plan.md)):

| Area | Path | What to check |
|------|------|----------------|
| Hub | `/devices` | Loads hub shell; default redirect to fleet tab (e.g. `/devices/vehicles`) |
| Vehicles | `/devices/vehicles` | Fleet roster, binding badges, vehicle CRUD entry, bind dialog |
| Devices (hardware) | `/devices/hardware` | Tablet inventory list; links to vehicle workspace when bound |
| Pairing | `/devices/pairing` | Pending pairing queue; reachable from hub switcher |
| Workspace | `/devices/vehicles/:vehicleId/overview` (and `config`, `diagnostic`) | Vehicle header; **all paired tablets** and per-device info |

If you previously bookmarked **`/devices/:vehicleId`**, confirm redirect to **`/devices/vehicles/:vehicleId/...`** after implementation.

## Tests

```bash
pnpm exec nx run openad-api:test
pnpm exec nx run openad-management:test
```

Hub and device-inventory coverage should include `devices-hub.page.spec.ts`, `device-inventory.page.spec.ts`, and related routing/workspace tests per [tasks.md](./tasks.md) (**T027**, **T044–T046**).

## Related docs

- [spec.md](./spec.md) — product requirements  
- [plan.md](./plan.md) — architecture including **Management UI route map**  
- [data-model.md](./data-model.md) — MongoDB shapes  
- [research.md](./research.md) — design decisions  
- [tasks.md](./tasks.md) — implementation order (hub **T028–T030** before roster UI refresh **T018–T019**)

## PR checklist (SC-002 spot-check)

- Create a vehicle through the UI or API with the known required fields (plate, make/model, tier, zone as applicable) and confirm success in under a few minutes on a warm dev stack.
- Duplicate registration plate among **active** vehicles should fail (covered by API tests **T014**/**T015**); binding audit is visible under **Vehicle detail → Binding history** when events exist.
