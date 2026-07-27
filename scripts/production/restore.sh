#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE must be the container path under /var/backups/community-selection}"

if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_COMMUNITY_SELECTION" ]]; then
  echo "Restore refused. Set RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION." >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-community-selection-production}"
export BACKUP_FILE RESTORE_CONFIRM

COMPOSE=(
  docker compose
  --project-name "${COMPOSE_PROJECT_NAME}" \
  --env-file "${ENV_FILE}"
  -f docker-compose.production.yml
)

pnpm --filter @community-selection/config build
node scripts/production/preflight.mjs --env-file "${ENV_FILE}"

echo "Stopping public traffic and API writes before restore."
"${COMPOSE[@]}" stop edge api
"${COMPOSE[@]}" --profile restore run --rm restore
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --wait --no-build --no-deps api
"${COMPOSE[@]}" up -d --no-build --no-deps edge
node scripts/production/smoke.mjs --env-file "${ENV_FILE}"
echo "Restore completed and public smoke checks passed."
