const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

function executable(file, body) {
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
    mode: 0o755,
  });
}

function fixture({ existingVolume = false } = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'community-selection-operations-'),
  );
  const bin = path.join(directory, 'bin');
  const log = path.join(directory, 'commands.log');
  const envFile = path.join(directory, 'production.env');
  fs.mkdirSync(bin);
  fs.writeFileSync(envFile, 'IMAGE_TAG=0123456789abcdef\n');

  executable(
    path.join(bin, 'docker'),
    [
      'printf "docker %s\\n" "$*" >> "${COMMAND_LOG}"',
      'if [[ "$1 $2" == "volume inspect" ]]; then',
      `  [[ "${existingVolume ? 'true' : 'false'}" == "true" ]]`,
      'fi',
    ].join('\n'),
  );
  executable(
    path.join(bin, 'pnpm'),
    'printf "pnpm %s\\n" "$*" >> "${COMMAND_LOG}"',
  );
  executable(
    path.join(bin, 'node'),
    'printf "node %s\\n" "$*" >> "${COMMAND_LOG}"',
  );

  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      COMMAND_LOG: log,
      ENV_FILE: envFile,
      COMPOSE_PROJECT_NAME: 'test-production',
    },
  };
}

function run(script, env) {
  return spawnSync('bash', [path.join(root, 'scripts/production', script)], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

test('deployment backs up an existing database before migration', () => {
  const context = fixture({ existingVolume: true });
  const result = run('deploy.sh', context.env);
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(context.log, 'utf8');
  const build = commands.indexOf('build api edge backup');
  const backup = commands.indexOf('--profile maintenance run --rm backup');
  const stop = commands.indexOf('stop edge api');
  const migrate = commands.indexOf('run --rm migrate');
  const api = commands.indexOf('up -d --wait --no-build --no-deps api');
  const edge = commands.indexOf('up -d --no-build --no-deps edge');
  const smoke = commands.indexOf('node scripts/production/smoke.mjs');
  assert.ok(build >= 0);
  assert.ok(backup > build);
  assert.ok(stop > backup);
  assert.ok(migrate > stop);
  assert.ok(api > migrate);
  assert.ok(edge > api);
  assert.ok(smoke > edge);
});

test('first deployment skips backup but still migrates before startup', () => {
  const context = fixture({ existingVolume: false });
  const result = run('deploy.sh', context.env);
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(context.log, 'utf8');
  assert.equal(commands.includes('--profile maintenance run --rm backup'), false);
  assert.ok(
    commands.indexOf('run --rm migrate') <
      commands.indexOf('up -d --wait --no-build --no-deps api'),
  );
});

test('rollback refuses to invoke Docker without exact confirmation', () => {
  const context = fixture();
  const result = run('rollback.sh', {
    ...context.env,
    PREVIOUS_IMAGE_TAG: 'abcdef1234567',
    ROLLBACK_CONFIRM: 'wrong',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ROLLBACK_COMMUNITY_SELECTION/);
  assert.equal(fs.existsSync(context.log), false);
});

test('rollback switches only application images and never runs migration', () => {
  const context = fixture();
  const result = run('rollback.sh', {
    ...context.env,
    PREVIOUS_IMAGE_TAG: 'abcdef1234567',
    ROLLBACK_CONFIRM: 'ROLLBACK_COMMUNITY_SELECTION',
  });
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(context.log, 'utf8');
  assert.match(commands, /up -d --wait --no-build --no-deps api/);
  assert.match(commands, /up -d --no-build --no-deps edge/);
  assert.doesNotMatch(commands, /migrate/);
  assert.match(commands, /node scripts\/production\/smoke\.mjs/);
});

test('backup and restore remain behind separate explicit profiles', () => {
  const backupContext = fixture();
  assert.equal(run('backup.sh', backupContext.env).status, 0);
  assert.match(
    fs.readFileSync(backupContext.log, 'utf8'),
    /--profile maintenance run --rm backup/,
  );

  const restoreContext = fixture();
  const refused = run('restore.sh', {
    ...restoreContext.env,
    BACKUP_FILE: '/var/backups/community-selection/known.dump.gpg',
    RESTORE_CONFIRM: 'wrong',
  });
  assert.notEqual(refused.status, 0);
  assert.equal(fs.existsSync(restoreContext.log), false);

  const allowed = run('restore.sh', {
    ...restoreContext.env,
    BACKUP_FILE: '/var/backups/community-selection/known.dump.gpg',
    RESTORE_CONFIRM: 'RESTORE_COMMUNITY_SELECTION',
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  const restoreCommands = fs.readFileSync(restoreContext.log, 'utf8');
  const stop = restoreCommands.indexOf('stop edge api');
  const restore = restoreCommands.indexOf('--profile restore run --rm restore');
  const migrate = restoreCommands.indexOf('run --rm migrate');
  const api = restoreCommands.indexOf('up -d --wait --no-build --no-deps api');
  const edge = restoreCommands.indexOf('up -d --no-build --no-deps edge');
  const smoke = restoreCommands.indexOf(
    'node scripts/production/smoke.mjs',
  );
  assert.ok(stop >= 0);
  assert.ok(restore > stop);
  assert.ok(migrate > restore);
  assert.ok(api > migrate);
  assert.ok(edge > api);
  assert.ok(smoke > edge);
});
