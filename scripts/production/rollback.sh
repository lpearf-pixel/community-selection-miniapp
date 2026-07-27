#!/usr/bin/env bash
set -euo pipefail

: "${PREVIOUS_IMAGE_TAG:?PREVIOUS_IMAGE_TAG is required}"

if [[ "${ROLLBACK_CONFIRM:-}" != "ROLLBACK_COMMUNITY_SELECTION" ]]; then
  echo "Rollback refused. Set ROLLBACK_CONFIRM=ROLLBACK_COMMUNITY_SELECTION." >&2
  exit 1
fi
if [[ ! "${PREVIOUS_IMAGE_TAG}" =~ ^[a-fA-F0-9]{7,40}$ ]]; then
  echo "PREVIOUS_IMAGE_TAG must be a 7-40 character Git commit SHA." >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-community-selection-production}"
export IMAGE_TAG="${PREVIOUS_IMAGE_TAG}"
COMPOSE=(
  docker compose
  --project-name "${COMPOSE_PROJECT_NAME}"
  --env-file "${ENV_FILE}"
  -f docker-compose.production.yml
)

pnpm --filter @community-selection/config build
node scripts/production/preflight.mjs --env-file "${ENV_FILE}"
docker image inspect "community-selection-api:${IMAGE_TAG}" >/dev/null
docker image inspect "community-selection-edge:${IMAGE_TAG}" >/dev/null

echo "Application-only rollback: database migrations will not be reversed."
"${COMPOSE[@]}" stop edge api
"${COMPOSE[@]}" up -d --wait --no-build --no-deps api
"${COMPOSE[@]}" up -d --no-build --no-deps edge
node scripts/production/smoke.mjs --env-file "${ENV_FILE}"
echo "Application rollback completed and public smoke checks passed."
