const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const fakeCommandSource = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(
  process.env.ADMIN_E2E_FAILURE_LOG,
  command + ' ' + args.join(' ') + '\n',
);
const scenario = process.env.ADMIN_E2E_FAILURE_SCENARIO;
if (command === 'docker' && args.includes('up') && scenario === 'database-start') {
  process.exit(17);
}
if (
  command === 'pnpm'
  && args.includes('fixture.ts')
  && args.includes('setup')
  && scenario === 'fixture-setup'
) {
  process.exit(18);
}
`;

function runFailureScenario(scenario) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-e2e-cleanup-'));
  const logPath = path.join(binDir, 'commands.log');
  try {
    for (const command of ['docker', 'pnpm']) {
      fs.writeFileSync(path.join(binDir, command), fakeCommandSource, { mode: 0o755 });
    }
    const result = spawnSync(process.execPath, ['scripts/admin-e2e/run.cjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        GITHUB_RUN_ID: `failure-${scenario}`,
        ADMIN_E2E_FAILURE_LOG: logPath,
        ADMIN_E2E_FAILURE_SCENARIO: scenario,
      },
    });
    return {
      result,
      log: fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '',
    };
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

test('cleans Compose resources when database startup partially fails', () => {
  const { result, log } = runFailureScenario('database-start');

  assert.notEqual(result.status, 0, result.stderr);
  assert.match(log, /docker compose .* up -d --wait postgres/);
  assert.match(log, /docker compose .* down --volumes --remove-orphans/);
  assert.ok(log.indexOf(' up -d --wait postgres') < log.indexOf(' down --volumes --remove-orphans'));
});

test('cleans a partially-created fixture when setup fails', () => {
  const { result, log } = runFailureScenario('fixture-setup');

  assert.notEqual(result.status, 0, result.stderr);
  assert.match(log, /pnpm exec tsx scripts\/admin-e2e\/fixture\.ts setup/);
  assert.match(log, /pnpm exec tsx scripts\/admin-e2e\/fixture\.ts cleanup/);
  assert.match(log, /docker compose .* down --volumes --remove-orphans/);
  assert.ok(log.indexOf('fixture.ts setup') < log.indexOf('fixture.ts cleanup'));
});
