const { spawnSync } = require('node:child_process');
const {
  mkdirSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');

function safeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'check';
}

function defaultExecute(check, options) {
  const result = spawnSync('bash', ['-lc', check.command], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: [
      result.stderr || '',
      result.error ? `${result.error.name}: ${result.error.message}\n` : '',
    ].join(''),
  };
}

function markdown(report) {
  const lines = [
    '# Verification Baseline Audit',
    '',
    `- Total: ${report.total}`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    `- Started: ${report.started_at}`,
    `- Completed: ${report.completed_at}`,
    '',
    '| Check | Layer | Status | Exit | Duration ms | Log |',
    '|---|---|---:|---:|---:|---|',
  ];
  for (const check of report.checks) {
    lines.push(
      `| ${check.id} | ${check.layer} | ${check.status} | ${check.exit_code} | ${check.duration_ms} | ${check.log_path} |`,
    );
  }
  lines.push('');
  if (report.failed > 0) {
    lines.push(
      '> Diagnostic observation only: failed checks remain untriaged until their isolated evidence is reviewed.',
      '',
    );
  }
  return lines.join('\n');
}

function runVerificationAudit(options) {
  const checks = options.checks || [];
  const ids = new Set();
  for (const check of checks) {
    if (ids.has(check.id)) {
      throw new Error(`Duplicate verification check id: ${check.id}`);
    }
    ids.add(check.id);
  }

  const outputDir = options.outputDir;
  const now = options.now || (() => new Date());
  const execute = options.execute || ((check) => defaultExecute(check, options));
  mkdirSync(outputDir, { recursive: true });

  const auditStarted = now();
  const observations = [];

  checks.forEach((check, index) => {
    const started = now();
    options.onProgress?.({ event: 'started', check, index, total: checks.length });
    const result = execute(check);
    const completed = now();
    const exitCode = Number.isInteger(result.status) ? result.status : 1;
    const logName = `${String(index + 1).padStart(3, '0')}-${safeId(check.id)}.log`;
    const logContent = [
      `id: ${check.id}`,
      `title: ${check.title}`,
      `layer: ${check.layer}`,
      `command: ${check.command}`,
      `started_at: ${started.toISOString()}`,
      `completed_at: ${completed.toISOString()}`,
      `exit_code: ${exitCode}`,
      `signal: ${result.signal || ''}`,
      '',
      '--- stdout ---',
      result.stdout || '',
      '--- stderr ---',
      result.stderr || '',
    ].join('\n');
    writeFileSync(join(outputDir, logName), logContent);

    const observation = {
      id: check.id,
      title: check.title,
      layer: check.layer,
      command: check.command,
      status: exitCode === 0 ? 'passed' : 'failed',
      exit_code: exitCode,
      signal: result.signal || null,
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: Math.max(0, completed.getTime() - started.getTime()),
      log_path: logName,
      classification: 'untriaged',
    };
    observations.push(observation);
    options.onProgress?.({
      event: 'completed',
      check,
      observation,
      index,
      total: checks.length,
    });
  });

  const completed = now();
  const failed = observations.filter((check) => check.status === 'failed').length;
  const report = {
    schema_version: 1,
    started_at: auditStarted.toISOString(),
    completed_at: completed.toISOString(),
    total: observations.length,
    passed: observations.length - failed,
    failed,
    checks: observations,
  };
  writeFileSync(join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outputDir, 'summary.md'), markdown(report));
  return report;
}

function auditExitCode(report, options = {}) {
  if (options.reportOnly) return 0;
  return report.failed > 0 ? 1 : 0;
}

module.exports = {
  auditExitCode,
  runVerificationAudit,
};
