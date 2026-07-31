const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { resolve } = require('node:path');

const {
  auditExitCode,
  runVerificationAudit,
} = require('../lib/verification-audit.cjs');

test('GitHub-hosted gates select isolated PostgreSQL ports', () => {
  const root = resolve(__dirname, '..', '..');
  for (const workflow of [
    '.github/workflows/verification-baseline-audit.yml',
    '.github/workflows/l50-c2-t3a-refund-gate.yml',
  ]) {
    const source = readFileSync(resolve(root, workflow), 'utf8');
    assert.match(
      source,
      /uses:\s*\.\/\.github\/actions\/configure-ci-postgres/,
    );
    assert.doesNotMatch(source, /DATABASE_URL=postgresql:\/\//);
    assert.doesNotMatch(source, /host\.docker\.internal/);
  }
});

test('baseline evaluates the production compliance seed before database-mutating historical verifiers', () => {
  const root = resolve(__dirname, '..', '..');
  const source = readFileSync(
    resolve(root, 'scripts/verification-baseline-manifest.ts'),
    'utf8',
  );
  const checks = source.match(
    /VERIFICATION_BASELINE_CHECKS[^=]*=\s*\[([\s\S]*?)\];/,
  )?.[1] ?? '';

  assert.match(checks, /\.\.\.seedFoundation/);
  assert.match(checks, /\.\.\.releaseGates/);
  assert.match(checks, /\.\.\.repositoryFoundation/);
  assert.match(checks, /\.\.\.registeredStages/);
  assert.ok(
    checks.indexOf('...seedFoundation') <
      checks.indexOf('...releaseGates') &&
      checks.indexOf('...releaseGates') <
        checks.indexOf('...repositoryFoundation') &&
      checks.indexOf('...releaseGates') < checks.indexOf('...registeredStages'),
    'L53 release gates must run immediately after the production seed and before repository or historical checks can mutate the database',
  );
});

test('L48 verifier rejects body identity fields instead of treating them as a successful withdrawal', () => {
  const root = resolve(__dirname, '..', '..');
  const source = readFileSync(
    resolve(root, 'scripts/verify-l48-security-privacy-docker-e2e-local.ts'),
    'utf8',
  );
  const scenario = source.match(
    /const withdrawalRequestId = `\$\{prefix\}-body-conflict-withdrawal`;([\s\S]*?)await requestJson\(`\/api\/leaders\/me\/withdrawals\/\$\{fixtures\.withdrawalB\.id\}`/,
  )?.[1] ?? '';

  assert.match(scenario, /expectedStatus:\s*400/);
  assert.doesNotMatch(scenario, /createdWithdrawal\.body\.data\.applied/);
  assert.match(scenario, /persistedWithdrawal\s*===\s*null/);
});

test('records every check after a middle failure and preserves isolated evidence', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'verification-audit-'));
  const executed = [];

  try {
    const report = runVerificationAudit({
      checks: [
        { id: 'first', title: 'First', layer: 'foundation', command: 'first-command' },
        { id: 'second', title: 'Second', layer: 'historical', command: 'second-command' },
        { id: 'third', title: 'Third', layer: 'historical', command: 'third-command' },
      ],
      outputDir,
      execute(check) {
        executed.push(check.id);
        return check.id === 'second'
          ? { status: 7, signal: null, stdout: 'second stdout\n', stderr: 'second stderr\n' }
          : { status: 0, signal: null, stdout: `${check.id} ok\n`, stderr: '' };
      },
      now: (() => {
        let value = 1_000;
        return () => new Date(value += 100);
      })(),
    });

    assert.deepEqual(executed, ['first', 'second', 'third']);
    assert.equal(report.total, 3);
    assert.equal(report.passed, 2);
    assert.equal(report.failed, 1);
    assert.deepEqual(report.checks.map((check) => check.status), ['passed', 'failed', 'passed']);
    assert.equal(report.checks[1].exit_code, 7);
    assert.equal(report.checks[1].classification, 'untriaged');
    assert.equal(auditExitCode(report, { reportOnly: false }), 1);
    assert.equal(auditExitCode(report, { reportOnly: true }), 0);

    const persisted = JSON.parse(readFileSync(join(outputDir, 'summary.json'), 'utf8'));
    assert.deepEqual(persisted, report);
    assert.match(readFileSync(join(outputDir, '002-second.log'), 'utf8'), /second stdout/);
    assert.match(readFileSync(join(outputDir, '002-second.log'), 'utf8'), /second stderr/);
    assert.match(readFileSync(join(outputDir, 'summary.md'), 'utf8'), /\| second \| historical \| failed \| 7 \|/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('rejects duplicate check IDs before executing commands', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'verification-audit-'));
  let executions = 0;

  try {
    assert.throws(
      () => runVerificationAudit({
        checks: [
          { id: 'duplicate', title: 'One', layer: 'foundation', command: 'one' },
          { id: 'duplicate', title: 'Two', layer: 'historical', command: 'two' },
        ],
        outputDir,
        execute() {
          executions += 1;
          return { status: 0, signal: null, stdout: '', stderr: '' };
        },
      }),
      /Duplicate verification check id: duplicate/,
    );
    assert.equal(executions, 0);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
