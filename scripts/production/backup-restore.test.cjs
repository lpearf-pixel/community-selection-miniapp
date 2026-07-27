const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const backupScript = path.join(root, 'scripts/pg-backup.sh');
const restoreScript = path.join(root, 'scripts/pg-restore.sh');

function executable(file, body) {
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
    mode: 0o755,
  });
}

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'community-selection-backup-'),
  );
  const bin = path.join(directory, 'bin');
  const backups = path.join(directory, 'backups');
  const passphrase = path.join(directory, 'passphrase');
  fs.mkdirSync(bin);
  fs.mkdirSync(backups);
  fs.writeFileSync(passphrase, 'test-only-passphrase\n', { mode: 0o600 });

  executable(
    path.join(bin, 'pg_dump'),
    [
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --file=*) printf "DATABASE-DUMP" > "${arg#--file=}" ; exit 0 ;;',
      '  esac',
      'done',
      'printf "DATABASE-DUMP"',
    ].join('\n'),
  );
  executable(
    path.join(bin, 'gpg'),
    [
      'if [[ "${FAKE_GPG_FAIL:-false}" == "true" ]]; then exit 19; fi',
      'mode=""',
      'output=""',
      'input=""',
      'while (($#)); do',
      '  case "$1" in',
      '    --symmetric) mode="encrypt" ;;',
      '    --decrypt) mode="decrypt" ;;',
      '    --output) shift; output="$1" ;;',
      '    --passphrase-file|--cipher-algo) shift ;;',
      '    --batch|--yes|--pinentry-mode|loopback) ;;',
      '    *) input="$1" ;;',
      '  esac',
      '  shift',
      'done',
      'if [[ "$mode" == "encrypt" ]]; then',
      '  { printf "ENCRYPTED:"; cat; } > "$output"',
      'else',
      '  if [[ "${FAKE_GPG_CORRUPT:-false}" == "true" ]]; then',
      '    printf "PARTIAL-DATABASE-DUMP"',
      '    exit 23',
      '  fi',
      '  sed "s/^ENCRYPTED://" "$input"',
      'fi',
    ].join('\n'),
  );
  executable(
    path.join(bin, 'pg_restore'),
    [
      'printf "%s\\n" "$*" > "${RESTORE_ARGS:?RESTORE_ARGS is required}"',
      'cat > "${RESTORE_CAPTURE:?RESTORE_CAPTURE is required}"',
    ].join('\n'),
  );

  return {
    directory,
    backups,
    passphrase,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL:
        'postgresql://community_selection:secret@postgres:5432/community_selection',
      BACKUP_DIR: backups,
      BACKUP_RETENTION_DAYS: '14',
      BACKUP_ENCRYPTION_PASSPHRASE_FILE: passphrase,
      RESTORE_ARGS: path.join(directory, 'restore.args'),
    },
  };
}

function run(script, env) {
  return spawnSync('bash', [script], {
    env,
    encoding: 'utf8',
  });
}

test('writes only an encrypted custom-format backup', () => {
  const context = fixture();
  const result = run(backupScript, context.env);
  assert.equal(result.status, 0, result.stderr);
  const files = fs.readdirSync(context.backups);
  assert.equal(files.length, 1);
  assert.match(files[0], /^community_selection_\d{8}T\d{6}Z\.dump\.gpg$/);
  assert.equal(
    fs.readFileSync(path.join(context.backups, files[0]), 'utf8'),
    'ENCRYPTED:DATABASE-DUMP',
  );
  assert.doesNotMatch(files[0], /\.partial$/);
});

test('removes expired encrypted backups after a successful backup', () => {
  const context = fixture();
  const expired = path.join(
    context.backups,
    'community_selection_20200101T000000Z.dump.gpg',
  );
  fs.writeFileSync(expired, 'old');
  fs.utimesSync(expired, new Date('2020-01-01'), new Date('2020-01-01'));
  const result = run(backupScript, {
    ...context.env,
    BACKUP_RETENTION_DAYS: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(expired), false);
});

test('leaves no partial or plaintext file when encryption fails', () => {
  const context = fixture();
  const result = run(backupScript, {
    ...context.env,
    FAKE_GPG_FAIL: 'true',
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(context.backups), []);
});

test('restore refuses to decrypt without the exact confirmation token', () => {
  const context = fixture();
  const backup = path.join(context.backups, 'known.dump.gpg');
  const capture = path.join(context.directory, 'restored.dump');
  fs.writeFileSync(backup, 'ENCRYPTED:DATABASE-DUMP');
  const result = run(restoreScript, {
    ...context.env,
    BACKUP_FILE: backup,
    RESTORE_CAPTURE: capture,
    RESTORE_CONFIRM: 'wrong',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESTORE_COMMUNITY_SELECTION/);
  assert.equal(fs.existsSync(capture), false);
});

test('decrypts into pg_restore only after explicit confirmation', () => {
  const context = fixture();
  const backup = path.join(context.backups, 'known.dump.gpg');
  const capture = path.join(context.directory, 'restored.dump');
  fs.writeFileSync(backup, 'ENCRYPTED:DATABASE-DUMP');
  const result = run(restoreScript, {
    ...context.env,
    BACKUP_FILE: backup,
    RESTORE_CAPTURE: capture,
    RESTORE_CONFIRM: 'RESTORE_COMMUNITY_SELECTION',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(capture, 'utf8'), 'DATABASE-DUMP');
  assert.match(
    fs.readFileSync(context.env.RESTORE_ARGS, 'utf8'),
    /--single-transaction/,
  );
});

test('verifies the whole encrypted stream before invoking pg_restore', () => {
  const context = fixture();
  const backup = path.join(context.backups, 'corrupt.dump.gpg');
  const capture = path.join(context.directory, 'restored.dump');
  fs.writeFileSync(backup, 'ENCRYPTED:CORRUPT');
  const result = run(restoreScript, {
    ...context.env,
    BACKUP_FILE: backup,
    RESTORE_CAPTURE: capture,
    RESTORE_CONFIRM: 'RESTORE_COMMUNITY_SELECTION',
    FAKE_GPG_CORRUPT: 'true',
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(capture), false);
});
