#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d%H%M%S)"
OUT="${BACKUP_DIR}/community_selection_${STAMP}.dump"
pg_dump "${DATABASE_URL}" --format=custom --file="${OUT}"
echo "Backup written to ${OUT}"
