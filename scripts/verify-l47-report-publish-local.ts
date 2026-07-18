import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getStageDefinition } from './stage-registry.ts';
import { resolveReportSource } from './stage-report-source.ts';
import { parseStageArg } from './stage-args.ts';
import { extractMarkdownFilePaths } from './report-markdown.ts';
import {
  L47_CENTER_API_CONTRACT,
  L47_PROHIBITED_RESPONSE_KEYS,
  L47_RUNTIME_MARKERS,
} from './l47-center-contract.ts';
import {
  L47_REPORT_EVIDENCE_LABELS,
  hasAllL47RuntimeMarkers,
  l47VerificationSourceCommit,
  transformL47Report,
} from './l47-report-evidence-hook.ts';

const stage = parseStageArg(process.argv.slice(2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function gitOutput(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitDiffFiles(base: string, head: string): string[] {
  return Array.from(
    new Set(
      gitOutput(['diff', '--name-only', `${base}...${head}`])
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function assertSetEqual(expected: string[], actual: string[], label: string): void {
  const missing = expected.filter((file) => !actual.includes(file));
  const extra = actual.filter((file) => !expected.includes(file));
  assert(
    missing.length === 0 && extra.length === 0,
    `${label} mismatch. missing=${missing.join(',')} extra=${extra.join(',')}`,
  );
}

function section(report: string, startHeader: string, endHeader: string): string {
  return report.split(startHeader)[1]?.split(endHeader)[0]?.trim() ?? '';
}

function completeVerifyOutput(commit: string): string {
  return [
    `verification_source_commit:${commit}`,
    'command_completed:L47 verifier=true',
    'command_completed:L47 center Docker E2E=true',
    'command_completed:L47 report routing verifier=true',
    'command_completed:L24-L47 chain regression=true',
    'L24-L47 chain regression passed.',
    'command_completed:Docker API E2E=true',
    'command_completed:Admin typecheck config check=true',
    'command_completed:Admin typecheck=true',
    'command_completed:raw compliance scan=true',
    'command_completed:Stage workflow=true',
    ...L47_RUNTIME_MARKERS,
  ].join('\n');
}

function reportFixture(unfinished = '暂无自动发现，需人工 review'): string {
  return [
    '# 阶段验收报告：L47',
    '',
    '## 1. 阶段结论',
    '',
    '- Codex 自评结论：partial',
    '',
    '## 3. API 变化',
    '',
    'fixture',
    '',
    '## 4. DB 变化',
    '',
    'fixture',
    '',
    '## 5. 核心业务验收点',
    '',
    '- [ ] generic review',
    '',
    '## 6. 验收脚本',
    '',
    'fixture',
    '',
    '## 7. 阶段验证执行结果',
    '',
    'fixture',
    '',
    '## 8. 合规边界检查',
    '',
    'fixture',
    '',
    '## 9. 风险点',
    '',
    '- 高风险：暂无自动发现，需人工 review',
    '- 中风险：暂无自动发现，需人工 review',
    '',
    '## 10. 未完成项',
    '',
    unfinished,
    '',
    '## 11. Codex 给人工 reviewer 的说明',
    '',
    'fixture',
  ].join('\n');
}

assert(stage === 'L47', 'L47 report publish verifier only accepts --stage=L47');

const fixtureCommit = 'a'.repeat(40);
const transformedPass = transformL47Report(
  reportFixture(),
  completeVerifyOutput(fixtureCommit),
  fixtureCommit,
);
assert(transformedPass.includes('Codex 自评结论：passed'), 'Complete L47 evidence fixture must pass');
assert(
  section(transformedPass, '## 3. API 变化', '## 4. DB 变化').includes('/api/me/center-summary') &&
    section(transformedPass, '## 3. API 变化', '## 4. DB 变化').includes('/api/leaders/me/center-summary'),
  'L47 evidence transform must render both center APIs',
);
assert(
  section(transformedPass, '## 4. DB 变化', '## 5. 核心业务验收点').includes('无新增 migration'),
  'L47 evidence transform must render no-DB-change decision',
);
assert(
  !section(transformedPass, '## 5. 核心业务验收点', '## 6. 验收脚本').includes('- [ ]'),
  'Complete L47 evidence fixture must check every checklist item',
);
assert(
  section(transformedPass, '## 10. 未完成项', '## 11. Codex 给人工 reviewer 的说明') === '暂无自动发现',
  'Complete L47 evidence fixture must clear generic unfinished placeholder',
);
assert(
  !section(transformedPass, '## 9. 风险点', '## 10. 未完成项').includes('需人工 review'),
  'Complete L47 evidence fixture must clear generic risk placeholders',
);

const transformedCommitMismatch = transformL47Report(
  reportFixture(),
  completeVerifyOutput('b'.repeat(40)),
  fixtureCommit,
);
assert(
  transformedCommitMismatch.includes('Codex 自评结论：partial'),
  'Evidence from another commit must remain partial',
);

const transformedMissingMarker = transformL47Report(
  reportFixture(),
  completeVerifyOutput(fixtureCommit).replace(L47_RUNTIME_MARKERS[0], ''),
  fixtureCommit,
);
assert(
  transformedMissingMarker.includes('Codex 自评结论：partial'),
  'Missing L47 runtime marker must keep report partial',
);

const todoMarker = 'TO' + 'DO';
const transformedTodo = transformL47Report(
  reportFixture(`- apps/api/src/example.ts:1 — ${todoMarker}: unresolved`),
  completeVerifyOutput(fixtureCommit),
  fixtureCommit,
);
assert(transformedTodo.includes('Codex 自评结论：partial'), 'Real unfinished L47 work must keep report partial');
assert(
  section(transformedTodo, '## 10. 未完成项', '## 11. Codex 给人工 reviewer 的说明').includes(`${todoMarker}: unresolved`),
  'Real unfinished L47 work must be preserved',
);

const currentCommit = gitOutput(['rev-parse', 'HEAD']);
const verifyOutput = read('reports/latest-verify-output.txt');
assert(
  l47VerificationSourceCommit(verifyOutput) === currentCommit,
  `L47 verification output must be bound to HEAD expected=${currentCommit} actual=${l47VerificationSourceCommit(verifyOutput) ?? 'missing'}`,
);
assert(hasAllL47RuntimeMarkers(verifyOutput), 'L47 verification output must contain all ten runtime markers');
for (const marker of L47_RUNTIME_MARKERS) {
  assert(verifyOutput.split(marker).length - 1 === 1, `L47 runtime marker must occur exactly once: ${marker}`);
}

execFileSync(
  'pnpm',
  ['exec', 'tsx', 'scripts/generate-stage-report-entry.ts', '--stage=L47'],
  { stdio: 'pipe' },
);

const report = read('reports/stage-L47-report.md');
const definition = getStageDefinition('L47');
assert(definition, 'L47 must be registered');
const source = resolveReportSource('L47');
assert(source.sourceMode === 'git_diff', 'L47 report source must use git_diff');
assert(report.includes('- 阶段：L47'), 'L47 report must identify its stage');
assert(report.includes(`- 注册阶段标题：${definition.title}`), 'L47 report must use the registered title');
assert(report.includes(`- 本阶段目标：${definition.title}`), 'L47 report must use the registered goal');
assert(report.includes(`- 业务稳定分支：${source.businessBaseBranch}`), 'L47 report must use the resolved business base branch');
assert(report.includes(`- 业务稳定 commit：${source.businessBaseCommit}`), 'L47 report must use the resolved business base commit');
assert(report.includes(`- 报告生成 commit：${currentCommit}`), 'L47 report generation commit must equal HEAD');

const changedFiles = gitDiffFiles(source.businessBaseCommit, 'HEAD');
const reportFiles = extractMarkdownFilePaths(report);
assertSetEqual(changedFiles, reportFiles, 'L47 report changed files');
for (const forbidden of [
  '.gitignore',
  'package.json',
  'pnpm-lock.yaml',
  'prisma/schema.prisma',
]) {
  assert(!changedFiles.includes(forbidden), `L47 business diff must not include ${forbidden}`);
}
for (const file of changedFiles) {
  assert(!file.startsWith('prisma/migrations/'), `L47 business diff must not include migration: ${file}`);
  assert(!file.startsWith('reports/'), `L47 business diff must not include reports: ${file}`);
  assert(!file.startsWith('.tmp/'), `L47 business diff must not include .tmp artifacts: ${file}`);
}

const apiSection = section(report, '## 3. API 变化', '## 4. DB 变化');
for (const api of L47_CENTER_API_CONTRACT) {
  const rows = apiSection
    .split('\n')
    .filter((line) => line.includes(`| ${api.method} | ${api.path} | ${api.auth} |`));
  assert(rows.length === 1 && rows[0].endsWith('| passed |'), `L47 API report row must pass: ${api.method} ${api.path}`);
}
assert(
  apiSection.split('\n').filter((line) => /^\| (GET|POST|PUT|PATCH|DELETE) \|/.test(line)).length === 2,
  'L47 report must contain exactly two API rows',
);
for (const key of L47_PROHIBITED_RESPONSE_KEYS) {
  assert(!apiSection.includes(key), `L47 API report examples must not expose prohibited key: ${key}`);
}

const dbSection = section(report, '## 4. DB 变化', '## 5. 核心业务验收点');
for (const statement of ['无新增表', '无新增字段', '无新增 migration']) {
  assert(dbSection.includes(statement), `L47 DB section missing statement: ${statement}`);
}

assert(report.includes('Codex 自评结论：passed') && !report.includes('Codex 自评结论：partial'), 'L47 report conclusion must be passed');
const checklistSection = section(report, '## 5. 核心业务验收点', '## 6. 验收脚本');
assert(!checklistSection.includes('- [ ]'), 'L47 report checklist must not contain unchecked items');
for (const label of L47_REPORT_EVIDENCE_LABELS) {
  const rows = checklistSection.split('\n').filter((line) => line.includes(`- [x] ${label}`));
  assert(rows.length === 1, `L47 report checklist must contain one checked item: ${label}`);
}
assert(
  checklistSection.split('\n').filter((line) => line.includes('- [x] L47 十个运行 marker 完整')).length === 1,
  'L47 report checklist must contain one runtime-marker item',
);

const verificationSection = section(report, '## 7. 阶段验证执行结果', '## 8. 合规边界检查');
for (const label of L47_REPORT_EVIDENCE_LABELS) {
  const rows = verificationSection.split('\n').filter((line) => line.includes(`| ${label} |`));
  assert(rows.length === 1 && rows[0].includes(`| ${label} | passed |`), `L47 report verification row must pass: ${label}`);
}
assert(
  verificationSection.includes('| L47 十个运行 marker | passed |'),
  'L47 runtime marker evidence row must pass',
);

const riskSection = section(report, '## 9. 风险点', '## 10. 未完成项');
assert(
  riskSection.includes('- 高风险：暂无自动发现') && riskSection.includes('- 中风险：暂无自动发现'),
  'L47 report risks must be normalized after complete evidence',
);
assert(!riskSection.includes('需人工 review'), 'L47 report risks must not retain generic placeholders');
assert(
  section(report, '## 10. 未完成项', '## 11. Codex 给人工 reviewer 的说明') === '暂无自动发现',
  'L47 report unfinished section must be empty',
);
assert(!report.includes('undefined'), 'L47 report must not contain undefined');

console.log('Report publish verification passed.');
