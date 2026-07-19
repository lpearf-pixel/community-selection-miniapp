import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  L48_REPORT_EVIDENCE_LABELS,
  L48_SECURITY_EVIDENCE_LABELS,
  hasExactL48RuntimeMarkers,
  l48VerificationSourceCommit,
} from './l48-report-evidence-hook.ts';
import {
  L48_BUSINESS_BASE_BRANCH,
  L48_BUSINESS_BASE_COMMIT,
  L48_FORBIDDEN_CHANGED_PATHS,
  L48_MINIMUM_CURRENT_USER_ROUTES,
  L48_PROHIBITED_RESPONSE_KEYS,
  L48_RUNTIME_MARKERS,
  isL48AllowedChangedPath,
} from './l48-security-privacy-contract.ts';
import { normalizeStageReportArtifact } from './report-artifact-normalizer.ts';
import { resolveReportSource } from './stage-report-source.ts';

const repoRoot = process.cwd();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

const stage = (
  process.argv.find((arg) => arg.startsWith('--stage='))?.slice(8) ?? ''
).toUpperCase();
const sourceBranch =
  process.env.REPORT_SOURCE_BRANCH ?? git(['rev-parse', '--abbrev-ref', 'HEAD']);
const sourceCommit = process.env.REPORT_SOURCE_COMMIT ?? git(['rev-parse', 'HEAD']);
const reportBranch = process.env.REPORT_BRANCH ?? 'stage-reports';
const reportWorktree = process.env.REPORT_BRANCH_WORKTREE ?? repoRoot;
const reportFile = join(repoRoot, 'reports', 'stage-L48-report.md');
const verifyFile = join(repoRoot, 'reports', 'latest-verify-output.txt');

function occurrenceCount(content: string, token: string): number {
  return content.split(token).length - 1;
}

function assertExactOnce(content: string, token: string, label: string): void {
  assert(
    occurrenceCount(content, token) === 1,
    `${label} must occur exactly once: ${token}`,
  );
}

function changedFiles(): string[] {
  const output = git([
    'diff',
    '--name-only',
    `${L48_BUSINESS_BASE_COMMIT}...${sourceCommit}`,
  ]);
  return output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertReportArtifactShape(report: string): void {
  assert(
    report.startsWith('# 阶段验收报告：L48'),
    'L48 report must start with the canonical title',
  );
  assert(
    occurrenceCount(report, '# 阶段验收报告：L48') === 1,
    'L48 report title must occur exactly once',
  );
  assert(!report.startsWith('\n'), 'L48 report must not have a leading blank line');
  for (let section = 1; section <= 11; section += 1) {
    assert(
      occurrenceCount(report, `## ${section}.`) === 1,
      `L48 report section ${section} must occur exactly once`,
    );
  }
  assert(!report.includes('undefined'), 'L48 report must not contain undefined');
  assert(
    !report.includes('not detected'),
    'L48 report contains incomplete machine evidence',
  );
  assert(
    !/\|\s*(failed|partial)\s*\|/i.test(report),
    'L48 report contains failed or partial evidence rows',
  );
}

function assertReportBinding(report: string, verifyOutput: string): void {
  assert(stage === 'L48', 'L48 strict verifier requires --stage=L48');
  assert(
    sourceBranch === 'work/l48-security-privacy-hardening',
    'Unexpected L48 source branch',
  );
  assert(
    /^[0-9a-f]{40}$/.test(sourceCommit),
    'L48 source commit must be a full SHA',
  );
  assert(reportBranch === 'stage-reports', 'L48 report must publish to stage-reports');
  assert(existsSync(reportWorktree), 'L48 report worktree path does not exist');
  assert(
    git(['rev-parse', 'HEAD']) === sourceCommit,
    'L48 source commit does not equal current business HEAD',
  );
  assert(
    l48VerificationSourceCommit(verifyOutput) === sourceCommit,
    'L48 verify output is not bound to current business HEAD',
  );
  assertExactOnce(
    verifyOutput,
    `verification_source_commit:${sourceCommit}`,
    'verification source commit',
  );
  assert(report.includes('- 阶段：L48'), 'L48 report stage metadata missing');
  assert(
    report.includes(`- 业务稳定分支：${L48_BUSINESS_BASE_BRANCH}`),
    'L48 stable branch mismatch',
  );
  assert(
    report.includes(`- 业务稳定 commit：${L48_BUSINESS_BASE_COMMIT}`),
    'L48 stable commit mismatch',
  );
  assert(
    report.includes(`- 报告生成分支：${sourceBranch}`),
    'L48 report source branch mismatch',
  );
  assert(
    report.includes(`- 报告生成 commit：${sourceCommit}`),
    'L48 report source commit mismatch',
  );
  assert(
    report.includes(`- 当前 commit：${sourceCommit}（报告生成环境）`),
    'L48 current commit metadata mismatch',
  );
  assert(
    report.includes('- 注册阶段标题：Security and Privacy Hardening'),
    'L48 registered title mismatch',
  );
  assert(
    report.includes('- Codex 自评结论：passed'),
    'L48 report conclusion is not passed',
  );
}

function assertEvidence(report: string, verifyOutput: string): void {
  assert(
    !/ERR_PNPM|ELIFECYCLE|failed with exit code|\berror TS\d{4}\b/.test(
      verifyOutput,
    ),
    'L48 verify output contains an explicit failure',
  );
  assert(
    hasExactL48RuntimeMarkers(verifyOutput),
    'L48 runtime markers are missing or duplicated',
  );
  for (const marker of L48_RUNTIME_MARKERS) {
    assertExactOnce(verifyOutput, marker, 'L48 runtime marker');
  }
  for (const label of [
    ...L48_REPORT_EVIDENCE_LABELS,
    ...L48_SECURITY_EVIDENCE_LABELS,
  ]) {
    assert(
      report.includes(`| ${label} | passed |`),
      `L48 report evidence is not passed: ${label}`,
    );
  }
  assert(
    report.includes('| L48 十个运行 marker 各出现一次 | passed |'),
    'L48 marker evidence row is not passed',
  );
  for (const route of L48_MINIMUM_CURRENT_USER_ROUTES) {
    assert(
      report.includes(`| ${route.method} | ${route.path} |`),
      `L48 report route row missing: ${route.method} ${route.path}`,
    );
  }
  assert(
    report.includes('- 无新增 migration'),
    'L48 report must declare no migration',
  );
  assert(
    report.includes('- 未修改 prisma/schema.prisma'),
    'L48 report must declare no schema change',
  );
  assert(
    report.includes(
      '可信 header 是当前项目边界，不等同于 JWT/OAuth 或微信 session 认证。',
    ),
    'L48 trusted-header limitation is missing',
  );
  assert(
    report.includes(
      '本阶段未实现加密、限流、CORS 重构、数据删除机制、自动打款或自动报税。',
    ),
    'L48 out-of-scope limitation is missing',
  );
  assert(
    report.includes('- 高风险：暂无自动发现'),
    'L48 report has unresolved high risk',
  );
  assert(
    report.includes('- 中风险：暂无自动发现'),
    'L48 report has unresolved medium risk',
  );
  assert(
    report.includes('## 10. 未完成项\n\n暂无自动发现'),
    'L48 report has unfinished items',
  );
}

function assertReportPrivacy(report: string): void {
  for (const claim of [
    'JWT/OAuth 已实现',
    '微信 session 认证已完成',
    '已实现数据库加密',
    '已实现接口限流',
    '自动打款已启用',
    '自动报税已启用',
    '零风险',
    '完全安全',
    '保证绝对安全',
  ]) {
    assert(!report.includes(claim), `L48 report contains prohibited claim: ${claim}`);
  }
  for (const sample of [
    '13912345678',
    'BANK-SECRET',
    'secret-host',
    'database-host-secret',
    'internal-tax-secret',
    'admin-secret-id',
  ]) {
    assert(
      !report.includes(sample),
      `L48 report contains raw sensitive sample: ${sample}`,
    );
  }
  for (const key of L48_PROHIBITED_RESPONSE_KEYS) {
    const rawExamplePattern = new RegExp(
      `\\b${key}\\s*[:=]\\s*[^|\\n]+`,
      'i',
    );
    assert(
      !rawExamplePattern.test(report),
      `L48 report contains a raw sensitive key example: ${key}`,
    );
  }
}

function assertChangedFileScope(): void {
  const files = changedFiles();
  assert(files.length > 0, 'L48 changed-file list is empty');
  for (const file of files) {
    assert(
      !L48_FORBIDDEN_CHANGED_PATHS.includes(
        file as (typeof L48_FORBIDDEN_CHANGED_PATHS)[number],
      ),
      `L48 forbidden file changed: ${file}`,
    );
    assert(!file.startsWith('prisma/migrations/'), `L48 migration changed: ${file}`);
    assert(!file.startsWith('reports/'), `L48 business branch contains report: ${file}`);
    assert(!file.startsWith('.tmp/'), `L48 business branch contains temp artifact: ${file}`);
    assert(
      isL48AllowedChangedPath(file),
      `L48 changed file is outside approved scope: ${file}`,
    );
  }
  const trackedArtifacts = git(['ls-files', 'reports', '.tmp'])
    .split(/\r?\n/)
    .filter(Boolean);
  assert(
    trackedArtifacts.length === 0,
    `L48 business branch tracks report/temp artifacts: ${trackedArtifacts.join(', ')}`,
  );
}

function assertReportRoutingSource(): void {
  const generator = readFileSync(
    join(repoRoot, 'scripts/generate-stage-report-entry.ts'),
    'utf8',
  );
  const workflow = readFileSync(join(repoRoot, 'scripts/stage-workflow.ts'), 'utf8');
  const publisher = readFileSync(
    join(repoRoot, 'scripts/publish-stage-report.ts'),
    'utf8',
  );
  assert(
    generator.includes("if (stage === 'L48') applyL48ReportEvidence()"),
    'L48 report hook is not registered',
  );
  assert(
    workflow.includes("stage === 'L48'") &&
      workflow.includes('verify-l48-report-publish-local.ts'),
    'L48 stage workflow routing is incomplete',
  );
  assert(
    publisher.includes('verify-l48-report-publish-local.ts'),
    'L48 publisher routing is incomplete',
  );
  assert(
    existsSync(join(repoRoot, 'docs/reviews/l48-security-privacy-hardening.md')),
    'L48 reviewer checklist is missing',
  );
}

assert(existsSync(reportFile), 'reports/stage-L48-report.md is missing');
assert(existsSync(verifyFile), 'reports/latest-verify-output.txt is missing');
const report = readFileSync(reportFile, 'utf8');
const verifyOutput = readFileSync(verifyFile, 'utf8');
const reportSource = resolveReportSource('L48');
assert(reportSource.sourceMode === 'git_diff', 'L48 report source must use git_diff');
assert(
  reportSource.businessBaseBranch === L48_BUSINESS_BASE_BRANCH,
  'L48 registry base branch mismatch',
);
assert(
  reportSource.businessBaseCommit === L48_BUSINESS_BASE_COMMIT,
  'L48 registry base commit mismatch',
);
assertReportArtifactShape(report);
assertReportBinding(report, verifyOutput);
assertEvidence(report, verifyOutput);
assertReportPrivacy(report);
assertChangedFileScope();
assertReportRoutingSource();

const normalized = normalizeStageReportArtifact('L48', report);
assert(normalized === report, 'L48 report is not in canonical normalized form');
const staleLatest = readdirSync(join(repoRoot, 'reports'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name.startsWith('latest-'))
  .map((entry) => entry.name)
  .filter((name) => name !== 'latest-verify-output.txt');
assert(
  staleLatest.length === 0,
  `L48 reports directory contains stale latest artifacts: ${staleLatest.join(', ')}`,
);

console.log('Report publish verification passed.');
