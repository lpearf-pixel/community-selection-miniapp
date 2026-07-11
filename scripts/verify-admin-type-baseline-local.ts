import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyVerificationResult, isVerificationBlocking, type VerificationIssue } from './lib/verification-result.js';

const baselinePath = join(process.cwd(), 'scripts/baselines/admin-typecheck-errors.txt');
const updateBaseline = process.argv.includes('--update-baseline');

function normalize(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const errors = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^(.*?)(?:\(\d+,\d+\))?:\s+error\s+(TS\d+):\s+(.*)$/);
    if (!match) continue;
    const file = relative(process.cwd(), join(process.cwd(), match[1])).replaceAll('\\', '/');
    const code = match[2];
    let message = match[3]
      .replace(/'([^']+)'/g, '$1')
      .replace(/"([^\"]+)"/g, '$1')
      .replace(/\.$/, '')
      .trim();
    if (message.startsWith('Module antd has no exported member ')) {
      message = message.replace('Module antd has no exported member ', 'antd has no exported member ');
    }
    errors.add(`${file}|${code}|${message}`);
  }
  return [...errors].sort();
}

function readBaseline(): string[] {
  if (!existsSync(baselinePath)) return [];
  return readFileSync(baselinePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .sort();
}

function toIssue(kind: 'new-type-error' | 'baseline-type-error', normalized: string, blocking: boolean): VerificationIssue {
  const [file, code, ...messageParts] = normalized.split('|');
  return { kind, code, file, message: messageParts.join('|'), blocking };
}

const result = spawnSync('pnpm', ['--filter', '@community-selection/admin', 'exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], {
  cwd: process.cwd(),
  encoding: 'utf8'
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const current = normalize(output);
if (updateBaseline) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, current.join('\n') + (current.length > 0 ? '\n' : ''));
  console.log(`Admin type baseline updated: ${current.length} error(s).`);
  process.exit(0);
}

const baseline = readBaseline();
const baselineSet = new Set(baseline);
const currentSet = new Set(current);
const verification = emptyVerificationResult();
verification.newTypeErrors = current.filter((line) => !baselineSet.has(line)).map((line) => toIssue('new-type-error', line, true));
verification.baselineTypeErrors = current.filter((line) => baselineSet.has(line)).map((line) => toIssue('baseline-type-error', line, false));
const improved = baseline.filter((line) => !currentSet.has(line));

if (result.error) {
  verification.environmentErrors.push({ kind: 'environment', code: 'ADMIN_TSC_EXEC_FAILED', message: result.error.message, blocking: true });
}

if (current.length === 0) console.log('Admin typecheck passed with zero errors.');
else if (verification.newTypeErrors.length === 0) console.log('Admin type baseline unchanged.');
else console.error('New Admin type errors detected.');

console.log(JSON.stringify({
  newTypeErrors: verification.newTypeErrors.length,
  baselineTypeErrors: verification.baselineTypeErrors.length,
  improvedBaselineErrors: improved.length,
  environmentErrors: verification.environmentErrors.length
}, null, 2));

for (const issue of [...verification.newTypeErrors, ...verification.baselineTypeErrors, ...verification.environmentErrors]) {
  const prefix = issue.blocking ? 'BLOCKING' : 'BASELINE';
  console.log(`${prefix} ${issue.file ?? '-'}|${issue.code}|${issue.message}`);
}
if (improved.length > 0) {
  console.log('Improved baseline errors:');
  for (const line of improved) console.log(`IMPROVED ${line}`);
}

process.exit(isVerificationBlocking(verification) ? 1 : 0);
