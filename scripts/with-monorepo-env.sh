#!/usr/bin/env bash
# Load layered env files for the monorepo, then run a command.
#
# docker | root (synonyms)
#   1. docker/.env
#   2. docker/.env.<dev|test|staging|prod> — suffix from NODE_ENV (default: dev)
#   Used for: docker compose, MinIO bucket init, any host command that only needs infra.
#
# app <folder-under-app/>
#   1. Repo root .env  — public: URLs, LOG_LEVEL, etc. (safe for web/tablet builds)
#   2. Repo root .env.<suffix>
#   3. app/<name>/.env
#   4. app/<name>/.env.<suffix>
#   Does NOT load docker/.env* (no broker passwords or compose secrets in frontends).
#
# Later files win (--overload). Use NODE_ENV=test|staging before this script to pick .env.test / .env.staging.
# Decryption: `-fk .env.keys` at repo root (shared by docker/ and app encrypted files).
#
# Usage:
#   scripts/with-monorepo-env.sh docker -- docker compose up -d
#   scripts/with-monorepo-env.sh app openad-api -- pnpm exec nx run openad-api:serve
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

env_suffix() {
  node -p "process.env.NODE_ENV === 'production' ? 'prod' : process.env.NODE_ENV === 'test' ? 'test' : process.env.NODE_ENV === 'staging' ? 'staging' : 'dev'"
}

MODE="${1:-}"
shift || true

# Allow callers to use `… docker -- docker …` / `… app api -- pnpm …`; dotenvx only needs one `--`.
if [[ "${1:-}" == "--" ]]; then
  shift
fi

case "$MODE" in
  docker|root)
    SUFFIX="$(env_suffix)"
    exec dotenvx run --ignore MISSING_ENV_FILE \
      -f docker/.env \
      -f "docker/.env.${SUFFIX}" \
      -fk ".env.keys" \
      --overload \
      -- "$@"
    ;;
  app)
    APP="${1:-}"
    if [[ -z "$APP" || "$APP" == "--" ]]; then
      echo "usage: $0 app <folder-under-app/> -- command..." >&2
      exit 1
    fi
    shift
    if [[ "${1:-}" == "--" ]]; then
      shift
    fi
    SUFFIX="$(env_suffix)"
    exec dotenvx run --ignore MISSING_ENV_FILE \
      -f .env \
      -f ".env.${SUFFIX}" \
      -f "app/${APP}/.env" \
      -f "app/${APP}/.env.${SUFFIX}" \
      -fk ".env.keys" \
      --overload \
      -- "$@"
    ;;
  *)
    echo "usage: $0 docker -- <command...>   (alias: root)" >&2
    echo "       $0 app <folder-under-app/> -- <command...>" >&2
    exit 1
    ;;
esac
