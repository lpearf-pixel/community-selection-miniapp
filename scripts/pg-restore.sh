#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE_FILE:?BACKUP_ENCRYPTION_PASSPHRASE_FILE is required}"

if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_COMMUNITY_SELECTION" ]]; then
  echo "Restore refused. Set RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION after verifying the target and backup." >&2
  exit 1
fi
if [[ ! -r "${BACKUP_FILE}" ]]; then
  echo "BACKUP_FILE is not readable" >&2
  exit 1
fi
if [[ "${BACKUP_FILE}" != *.dump.gpg ]]; then
  echo "BACKUP_FILE must be an encrypted .dump.gpg file" >&2
  exit 1
fi
if [[ ! -s "${BACKUP_ENCRYPTION_PASSPHRASE_FILE}" ]]; then
  echo "Backup passphrase file is missing or empty" >&2
  exit 1
fi

# GPG may emit bytes before reporting an integrity failure. Verify the entire
# encrypted stream first so pg_restore is never invoked for a corrupt backup.
gpg \
  --batch \
  --pinentry-mode loopback \
  --passphrase-file "${BACKUP_ENCRYPTION_PASSPHRASE_FILE}" \
  --decrypt "${BACKUP_FILE}" \
  >/dev/null

gpg \
  --batch \
  --pinentry-mode loopback \
  --passphrase-file "${BACKUP_ENCRYPTION_PASSPHRASE_FILE}" \
  --decrypt "${BACKUP_FILE}" \
  | pg_restore \
      --clean \
      --if-exists \
      --no-owner \
      --exit-on-error \
      --single-transaction \
      --dbname="${DATABASE_URL}"

echo "Restore completed from encrypted backup ${BACKUP_FILE}"
