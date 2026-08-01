#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE must be the container path under /var/backups/community-selection}"

if [[ "${RESTORE_DRILL_CONFIRM:-}" != "RESTORE_IN_ISOLATED_DRILL" ]]; then
  echo "Restore drill refused. Set RESTORE_DRILL_CONFIRM=RESTORE_IN_ISOLATED_DRILL." >&2
  exit 1
fi

RESTORE_DRILL_ID="${RESTORE_DRILL_ID:-$(date -u +%Y%m%d%H%M%S)-$$}"
if [[ ! "${RESTORE_DRILL_ID}" =~ ^[a-z0-9][a-z0-9-]{5,31}$ ]]; then
  echo "RESTORE_DRILL_ID must be 6-32 lowercase letters, digits, or hyphens." >&2
  exit 1
fi
if [[ "${BACKUP_FILE}" != /var/backups/community-selection/*.dump.gpg || "${BACKUP_FILE}" == *".."* ]]; then
  echo "BACKUP_FILE must be an encrypted file directly under /var/backups/community-selection." >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-.env.production}"
PRODUCTION_BACKUP_VOLUME="${PRODUCTION_BACKUP_VOLUME:-community-selection-production_production-backups}"
if [[ ! "${PRODUCTION_BACKUP_VOLUME}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]]; then
  echo "PRODUCTION_BACKUP_VOLUME contains unsafe characters." >&2
  exit 1
fi
if [[ ! "${PRODUCTION_BACKUP_VOLUME}" =~ _production-backups$ ]]; then
  echo "PRODUCTION_BACKUP_VOLUME must identify the production backup volume." >&2
  exit 1
fi

COMPOSE_PROJECT_NAME="community-selection-restore-drill-${RESTORE_DRILL_ID}"
DRILL_STARTED=false
export PRODUCTION_BACKUP_VOLUME
COMPOSE=(
  docker compose
  --project-name "${COMPOSE_PROJECT_NAME}"
  --env-file "${ENV_FILE}"
  -f docker-compose.production.yml
  -f docker-compose.restore-drill.yml
)

cleanup() {
  local status=$?
  local cleanup_failed=false
  if [[ "${status}" -ne 0 && "${RESTORE_DRILL_KEEP_ON_FAILURE:-false}" == "true" ]]; then
    echo "Restore drill failed; preserving isolated project ${COMPOSE_PROJECT_NAME} for inspection." >&2
  elif [[ "${DRILL_STARTED}" == "true" ]]; then
    if ! "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null; then
      echo "Restore drill cleanup failed for ${COMPOSE_PROJECT_NAME}." >&2
      cleanup_failed=true
    fi
  fi
  if [[ "${status}" -eq 0 && "${cleanup_failed}" == "true" ]]; then
    status=1
  fi
  exit "${status}"
}
trap cleanup EXIT

RELEASE_SHA="$(node scripts/production/restore-drill-release.mjs "${ENV_FILE}")"
if [[ -n "${IMAGE_TAG:-}" && "${IMAGE_TAG}" != "${RELEASE_SHA}" ]]; then
  echo "shell IMAGE_TAG conflicts with the env file release." >&2
  exit 1
fi
export IMAGE_TAG="${RELEASE_SHA}"
pnpm --filter @community-selection/config build
node scripts/production/preflight.mjs --env-file "${ENV_FILE}"
docker volume inspect "${PRODUCTION_BACKUP_VOLUME}" >/dev/null

"${COMPOSE[@]}" config --quiet
DRILL_STARTED=true
"${COMPOSE[@]}" up -d --wait postgres
"${COMPOSE[@]}" --profile restore run --rm \
  -e BACKUP_FILE="${BACKUP_FILE}" \
  -e RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION \
  restore
"${COMPOSE[@]}" run --rm migrate
AUDIT_SUMMARY="$("${COMPOSE[@]}" exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT '\''migrations='\'' || count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL; SELECT '\''orders='\'' || count(*) FROM \"Order\"; SELECT '\''payments='\'' || count(*) FROM \"Payment\"; SELECT '\''refunds='\'' || count(*) FROM \"Refund\"; SELECT '\''group_buys='\'' || count(*) FROM \"GroupBuy\";"')"

for label in migrations orders payments refunds group_buys; do
  if ! printf '%s\n' "${AUDIT_SUMMARY}" | grep -Eq "^${label}=[0-9]+$"; then
    echo "Restore drill audit output is missing ${label}." >&2
    exit 1
  fi
done

printf 'L57_RESTORE_DRILL release_sha=%s backup_file=%s project=%s\n' \
  "${RELEASE_SHA}" "$(basename "${BACKUP_FILE}")" "${COMPOSE_PROJECT_NAME}"
printf '%s\n' "${AUDIT_SUMMARY}"
