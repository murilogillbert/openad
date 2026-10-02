# Implementation notes (T001): plan vs repository

**Date**: 2026-04-05  
**Spec**: `specs/003-tablet-ops-pipeline`

## Alignment snapshot

| Plan area | Repository state (initial) | Action |
|-----------|----------------------------|--------|
| `app/openad-api` — devices, fleet-monitor | Present (`DeviceBindingService`, `DeviceJwtAuthGuard`, `remote_commands`) | Extend with pairing collections, fingerprint util, JWT `fp`, extended command types |
| `app/openad-management` | Fleet/dashboard UI | Add pending pairings + command extensions per tasks |
| `app/openad-ad-client` | MQTT, storage, power, `DeviceSessionService` | Add pairing UI, hardware fingerprint service, watchdog/sync per tasks |
| `libs/domain` | `Device`, lifecycle types | Add `HardwareFingerprint`, pairing/watchdog types |
| `libs/api-contracts` | REST DTOs | Add pairing + manifest delta DTOs |
| `libs/mqtt-contracts` | Zod MQTT schemas | Extend `serverCommandPayloadSchema` for new command types |

## Nx targets (see T002)

- API: `pnpm exec nx run openad-api:serve` (root script `api:serve` uses dotenvx + nx).
- Management: `pnpm exec nx run openad-management:serve` (`management:serve`).
- Tablet: `pnpm exec nx run openad-ad-client:serve` — use `serve` target in `app/openad-ad-client/project.json`; Capacitor run via `@nxext/capacitor` or `npx cap` after build.

## Branch

Work tracked against branch `003-tablet-ops-pipeline` per `plan.md`.

## Progress (speckit.implement)

- **Checklist** `checklists/requirements.md`: all items complete — proceed.
- **Completed in repo**: Phase 1 (T001–T003); Phase 2 (T004–T010, T012–T014); T011 satisfied for **003 pairing bind** JWT (`fp` claim + `DeviceAccessTokenPayload`); legacy vehicle `DeviceBindingService` bind unchanged (no `fp` until those devices use fingerprint).
- **US1 (API)**: T015, T017–T019, T018 (pairing + admin pairing-secret controllers). **Remaining US1**: T016 (e2e), T020–T026 (tablet + management UI).
- **US2–US4 + Polish**: not started in this pass (`tasks.md` checkboxes unchanged for those lines).
