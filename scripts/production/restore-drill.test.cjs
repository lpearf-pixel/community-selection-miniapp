const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const script = path.join(root, 'scripts/production/restore-drill.sh');
const override = path.join(root, 'docker-compose.restore-drill.yml');

function executable(file, body) {
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
    mode: 0o755,
  });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'l57-restore-drill-'));
  const bin = path.join(directory, 'bin');
  const log = path.join(directory, 'commands.log');
  const envFile = path.join(directory, 'production.env');
  fs.mkdirSync(bin);
  fs.writeFileSync(envFile, 'IMAGE_TAG=ac5c7cce158f5314db976ff2d130185292c46cad\n');
  executable(
    path.join(bin, 'docker'),
    'printf "docker %s\\n" "$*" >> "${COMMAND_LOG}"\nif [[ "$*" == *"down --volumes"* && "${FAIL_DOWN:-false}" == "true" ]]; then exit 42; fi\nif [[ "$*" == *"exec -T postgres"* ]]; then printf "migrations=31\\norders=2\\npayments=1\\nrefunds=1\\ngroup_buys=1\\n"; fi',
  );
  executable(
    path.join(bin, 'pnpm'),
    'printf "pnpm %s\\n" "$*" >> "${COMMAND_LOG}"',
  );
  executable(
    path.join(bin, 'node'),
    'printf "node %s\\n" "$*" >> "${COMMAND_LOG}"\nif [[ "$*" == *"restore-drill-release.mjs"* ]]; then printf "ac5c7cce158f5314db976ff2d130185292c46cad\\n"; fi',
  );
  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      COMMAND_LOG: log,
      ENV_FILE: envFile,
      BACKUP_FILE: '/var/backups/community-selection/known.dump.gpg',
      RESTORE_DRILL_ID: 'acceptance01',
      PRODUCTION_BACKUP_VOLUME: 'community-selection-production_production-backups',
    },
  };
}

function run(env) {
  assert.equal(fs.existsSync(script), true, 'restore-drill.sh must exist');
  assert.equal(fs.existsSync(override), true, 'restore drill Compose override must exist');
  return spawnSync('bash', [script], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

test('refuses the drill before invoking Docker without exact confirmation', () => {
  const context = fixture();
  const result = run({ ...context.env, RESTORE_DRILL_CONFIRM: 'wrong' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESTORE_IN_ISOLATED_DRILL/);
  assert.equal(fs.existsSync(context.log), false);
});

test('uses a unique drill project and never the production project', () => {
  const context = fixture();
  const result = run({
    ...context.env,
    RESTORE_DRILL_CONFIRM: 'RESTORE_IN_ISOLATED_DRILL',
  });

  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(context.log, 'utf8');
  assert.match(commands, /--project-name community-selection-restore-drill-acceptance01/);
  assert.doesNotMatch(commands, /--project-name community-selection-production(?:\s|$)/);
  assert.match(commands, /up -d --wait postgres/);
  assert.match(commands, /--profile restore run --rm .* restore/);
  assert.match(commands, /run --rm migrate/);
  assert.match(commands, /exec -T postgres/);
  assert.match(commands, /down --volumes --remove-orphans/);
  assert.match(result.stdout, /release_sha=ac5c7cce158f5314db976ff2d130185292c46cad/);
  assert.match(result.stdout, /backup_file=known\.dump\.gpg/);
  assert.match(result.stdout, /migrations=31/);
  assert.match(result.stdout, /orders=2/);
  assert.match(result.stdout, /payments=1/);
  assert.match(result.stdout, /refunds=1/);
  assert.match(result.stdout, /group_buys=1/);
  assert.doesNotMatch(result.stdout, /unknown/);
});

test('keeps the production backup volume external and read-only', () => {
  assert.equal(fs.existsSync(override), true, 'restore drill Compose override must exist');
  const source = fs.readFileSync(override, 'utf8');

  assert.match(source, /name: \$\{PRODUCTION_BACKUP_VOLUME/);
  assert.match(source, /external: true/);
  assert.match(source, /production-backups:\/var\/backups\/community-selection:ro/);
  assert.match(source, /restore-drill-postgres:\/var\/lib\/postgresql\/data/);
});

test('rejects an unsafe drill identifier before invoking Docker', () => {
  const context = fixture();
  const result = run({
    ...context.env,
    RESTORE_DRILL_CONFIRM: 'RESTORE_IN_ISOLATED_DRILL',
    RESTORE_DRILL_ID: '../production',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESTORE_DRILL_ID/);
  assert.equal(fs.existsSync(context.log), false);
});

test('rejects a volume that is not explicitly a production backup volume', () => {
  const context = fixture();
  const result = run({
    ...context.env,
    RESTORE_DRILL_CONFIRM: 'RESTORE_IN_ISOLATED_DRILL',
    PRODUCTION_BACKUP_VOLUME: 'community-selection-production_production-postgres',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production backup volume/);
  assert.equal(fs.existsSync(context.log), false);
});

test('rejects a shell IMAGE_TAG that would override the env file release', () => {
  const context = fixture();
  const result = run({
    ...context.env,
    RESTORE_DRILL_CONFIRM: 'RESTORE_IN_ISOLATED_DRILL',
    IMAGE_TAG: '52db733000000000000000000000000000000000',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /shell IMAGE_TAG conflicts/);
  const commands = fs.readFileSync(context.log, 'utf8');
  assert.doesNotMatch(commands, /^docker /m);
});

test('reports cleanup failure when a successful drill leaves resources behind', () => {
  const context = fixture();
  const result = run({
    ...context.env,
    RESTORE_DRILL_CONFIRM: 'RESTORE_IN_ISOLATED_DRILL',
    FAIL_DOWN: 'true',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cleanup failed/);
});
