const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

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
  && args.some((arg) => arg.endsWith('/fixture.ts'))
  && args.includes('setup')
  && scenario === 'fixture-setup'
) {
  process.exit(18);
}
if (
  command === 'pnpm'
  && scenario === 'signal'
  && (
    args.includes('@community-selection/api')
    || args.includes('@community-selection/admin')
  )
) {
  setTimeout(() => process.exit(0), 1_000);
}
`;

function createScenarioEnvironment(scenario) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-e2e-cleanup-'));
  const logPath = path.join(binDir, 'commands.log');
  for (const command of ['docker', 'pnpm']) {
    fs.writeFileSync(path.join(binDir, command), fakeCommandSource, { mode: 0o755 });
  }
  return {
    binDir,
    logPath,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      GITHUB_RUN_ID: `failure-${scenario}`,
      ADMIN_E2E_FAILURE_LOG: logPath,
      ADMIN_E2E_FAILURE_SCENARIO: scenario,
    },
  };
}

function readLog(logPath) {
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

function runFailureScenario(scenario) {
  const context = createScenarioEnvironment(scenario);
  try {
    const result = spawnSync(process.execPath, ['scripts/admin-e2e/run.cjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: context.env,
    });
    return { result, log: readLog(context.logPath) };
  } finally {
    fs.rmSync(context.binDir, { recursive: true, force: true });
  }
}

async function waitForLog(logPath, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = readLog(logPath);
    if (predicate(log)) return log;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for command log:\n${readLog(logPath)}`);
}

function waitForClose(child) {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
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

test('cleans fixture and Compose resources when the runner sends SIGTERM', async () => {
  const context = createScenarioEnvironment('signal');
  const child = spawn(process.execPath, ['scripts/admin-e2e/run.cjs'], {
    cwd: root,
    env: context.env,
    stdio: 'ignore',
  });
  try {
    await waitForLog(
      context.logPath,
      (log) => log.includes('@community-selection/api') && log.includes('@community-selection/admin'),
    );
    child.kill('SIGTERM');
    await waitForClose(child);

    const log = readLog(context.logPath);
    assert.match(log, /pnpm exec tsx scripts\/admin-e2e\/fixture\.ts cleanup/);
    assert.match(log, /docker compose .* down --volumes --remove-orphans/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(context.binDir, { recursive: true, force: true });
  }
});

test('external cleanup removes only the exact cancelled run resources', () => {
  const context = createScenarioEnvironment('external-cancel');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/admin-e2e/cleanup-resources.cjs', '29999909088'],
      {
        cwd: root,
        encoding: 'utf8',
        env: context.env,
      },
    );
    const log = readLog(context.logPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(log, /docker rm -f community-selection-admin-e2e-browser-29999909088/);
    assert.match(
      log,
      /docker compose -p community-selection-admin-e2e-29999909088 -f docker-compose\.yml down --volumes --remove-orphans/,
    );
    assert.doesNotMatch(log, /docker system prune/);
  } finally {
    fs.rmSync(context.binDir, { recursive: true, force: true });
  }
});
