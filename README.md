# OpenAD — Transit advertising platform (monorepo)

Nx workspace containing the **OpenAD** management API (NestJS), the operator **portal** (Angular), and shared libraries (`@openad/domain`, `@openad/api-contracts`, `@openad/mqtt-contracts`).

## Prerequisites

- **Node.js** 20 LTS and **pnpm** (see root `package.json` for package manager)
- **Docker** and Docker Compose (for MongoDB, Redis, RabbitMQ MQTT, MinIO S3 + web console)

## Quick start

1. Copy environment defaults: `cp .env.example .env` and adjust secrets for local use.
2. Start infrastructure: `pnpm docker:up` (or `docker compose up -d` from the repo root).
3. **API**: `pnpm exec nx run openad-api:serve` — REST base path `http://localhost:3000/api/v1`, Swagger UI at `http://localhost:3000/api/docs`, health at `http://localhost:3000/api/health`.
4. **Portal**: `pnpm exec nx run openad-management:serve` — open the printed local URL (typically `http://localhost:4200`).

End-to-end architecture, flows, and ports are documented in [`specs/001-transit-ad-platform-foundation/quickstart.md`](specs/001-transit-ad-platform-foundation/quickstart.md).

**Media orchestration (manifest, sync, playback, constraints)** — developer setup and validation: [`specs/004-media-orchestration-pipeline/quickstart.md`](specs/004-media-orchestration-pipeline/quickstart.md). Production API image: `Dockerfile.api` and [`docker-compose.prod.yml`](docker-compose.prod.yml). Prometheus scrape: `GET /api/metrics` (outside `/api/v1` prefix).

## Useful commands

| Goal | Command |
|------|---------|
| Lint | `pnpm exec nx run-many --target=lint --all` |
| API unit & integration tests | `pnpm exec nx run openad-api:test` |
| API with coverage | `pnpm exec nx run openad-api:test --coverage` |
| Build portal | `pnpm exec nx run openad-management:build` |
| OpenAPI JSON (with API running) | `curl -s http://localhost:3000/api/docs-json -o app/openad-api/openapi.json` |

## Repository layout

- `app/openad-api` — NestJS backend (REST, MQTT, BullMQ, Socket.IO fleet channel)
- `app/openad-management` — Angular management portal
- `libs/` — shared types and contracts
- `docker/` — broker config (e.g. RabbitMQ plugins)
- `specs/001-transit-ad-platform-foundation/` — feature spec, tasks, quickstart, validation notes

## License

Proprietary — see your organization’s policy.
