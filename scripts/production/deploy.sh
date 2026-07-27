#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-community-selection-production}"
COMPOSE=(
  docker compose
  --project-name "${COMPOSE_PROJECT_NAME}"
  --env-file "${ENV_FILE}"
  -f docker-compose.production.yml
)

pnpm --filter @community-selection/config build
node scripts/production/preflight.mjs --env-file "${ENV_FILE}"

"${COMPOSE[@]}" build api edge backup

POSTGRES_VOLUME="${COMPOSE_PROJECT_NAME}_production-postgres"
if docker volume inspect "${POSTGRES_VOLUME}" >/dev/null 2>&1; then
  echo "Existing database volume found; taking encrypted pre-migration backup."
  "${COMPOSE[@]}" up -d --wait postgres
  "${COMPOSE[@]}" --profile maintenance run --rm backup
else
  echo "First deployment; no existing database volume to back up."
  "${COMPOSE[@]}" up -d --wait postgres
fi

echo "Stopping public traffic and API writes before schema migration."
"${COMPOSE[@]}" stop edge api
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --wait --no-build --no-deps api
"${COMPOSE[@]}" up -d --no-build --no-deps edge
"${COMPOSE[@]}" ps

node scripts/production/smoke.mjs --env-file "${ENV_FILE}"
echo "Production deployment completed and public smoke checks passed."
