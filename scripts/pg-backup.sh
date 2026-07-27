#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE_FILE:?BACKUP_ENCRYPTION_PASSPHRASE_FILE is required}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/community-selection}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [[ ! -r "${BACKUP_ENCRYPTION_PASSPHRASE_FILE}" ]]; then
  echo "Backup passphrase file is not readable" >&2
  exit 1
fi
if [[ ! -s "${BACKUP_ENCRYPTION_PASSPHRASE_FILE}" ]]; then
  echo "Backup passphrase file is empty" >&2
  exit 1
fi
if [[ ! "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi

umask 077
mkdir -p "${BACKUP_DIR}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL="${BACKUP_DIR}/community_selection_${STAMP}.dump.gpg"
PARTIAL="${FINAL}.partial"

cleanup() {
  rm -f -- "${PARTIAL}"
}
trap cleanup EXIT

pg_dump "${DATABASE_URL}" --format=custom \
  | gpg \
      --batch \
      --yes \
      --pinentry-mode loopback \
      --passphrase-file "${BACKUP_ENCRYPTION_PASSPHRASE_FILE}" \
      --cipher-algo AES256 \
      --symmetric \
      --output "${PARTIAL}"

if [[ ! -s "${PARTIAL}" ]]; then
  echo "Encrypted backup is empty" >&2
  exit 1
fi

gpg \
  --batch \
  --pinentry-mode loopback \
  --passphrase-file "${BACKUP_ENCRYPTION_PASSPHRASE_FILE}" \
  --decrypt "${PARTIAL}" \
  >/dev/null

mv -- "${PARTIAL}" "${FINAL}"
trap - EXIT

find "${BACKUP_DIR}" \
  -type f \
  -name 'community_selection_*.dump.gpg' \
  -mtime "+${BACKUP_RETENTION_DAYS}" \
  -delete

echo "Encrypted backup written to ${FINAL}"
