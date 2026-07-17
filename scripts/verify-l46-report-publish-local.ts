import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getStageDefinition } from './stage-registry.ts';
import { resolveReportSource } from './stage-report-source.ts';
import { parseStageArg } from './stage-args.ts';
import {
  L46_REPORT_EVIDENCE_LABELS,
  transformL46Report,
  verificationSourceCommit,
} from './l46-report-evidence-hook.ts';

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
  return Array.from(new Set(gitOutput(['diff', '--name-only', `${base}...${head}`]).split('\n').map((line) => line.trim()).filter(Boolean))).sort();
}

function extractMarkdownFilePaths(report: string): string[] {
  const range = report.split('## 2. 本阶段变更范围')[1]?.split('## 3. API 变化')[0] ?? '';
  const files: string[] = [];
  for (const line of range.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const file = cells[1];
    if (file === '文件' || file === '---') continue;
    if (file.includes('/') || file === 'docker-compose.yml') files.push(file);
  }
  return Array.from(new Set(files)).sort();
}

function assertSetEqual(expected: string[], actual: string[], label: string): void {
  const missing = expected.filter((file) => !actual.includes(file));
  const extra = actual.filter((file) => !expected.includes(file));
  assert(missing.length === 0 && extra.length === 0, `${label} mismatch. missing=${missing.join(',')} extra=${extra.join(',')}`);
}

function section(report: string, startHeader: string, endHeader: string): string {
  return report.split(startHeader)[1]?.split(endHeader)[0]?.trim() ?? '';
}

function completeVerifyOutput(commit: string): string {
  return [
    `verification_source_commit:${commit}`,
    'command_completed:L46 verifier=true',
    'command_completed:L46 tax-record DB scope verifier=true',
    'command_completed:L24-L46 chain regression=true',
    'L24-L46 chain regression passed.',
    'command_completed:Docker API E2E=true',
    'command_completed:Admin typecheck config check=true',
    'command_completed:Admin typecheck=true',
    'command_completed:raw compliance scan=true',
    'command_completed:Stage workflow=true',
  ].join('\n');
}

function reportFixture(unfinished = '暂无自动发现，需人工 review'): string {
  return [
    '# 阶段验收报告：L46',
    '',
    '## 1. 阶段结论',
    '',
    '- Codex 自评结论：partial',
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

assert(stage === 'L46', 'L46 report publish verifier only accepts --stage=L46');

const resolverSource = read('scripts/stage-report-source.ts');
const entrySource = read('scripts/generate-stage-report-entry.ts');
const evidenceSource = read('scripts/l46-report-evidence-hook.ts');
assert(!resolverSource.includes('l46-report-evidence') && !resolverSource.includes('beforeExit'), 'Report source resolver must remain free of L46 report side effects');
const generatorImportIndex = entrySource.indexOf("import './generate-stage-report.ts'");
const evidenceApplyIndex = entrySource.indexOf('applyL46ReportEvidence()');
assert(generatorImportIndex >= 0 && evidenceApplyIndex > generatorImportIndex, 'L46 report entry must explicitly apply evidence after the base generator completes');
for (const forbidden of ['beforeExit', 'process.once', 'process.argv[1]']) assert(!evidenceSource.includes(forbidden), `L46 evidence module must not depend on ${forbidden}`);
assert(/if\s*\(\s*stage\s*===\s*['"]L46['"]\s*\)\s*applyL46ReportEvidence\s*\(\s*\)/.test(entrySource), 'L46 report entry must only apply evidence for L46');
assert(evidenceSource.includes('verification_source_commit') && evidenceSource.includes('verificationSourceCommit'), 'L46 evidence module must require commit-bound verification output');

const workflowSource = read('scripts/stage-workflow.ts');
const compactWorkflow = workflowSource.replace(/\s+/g, ' ');
const reportStageStart = compactWorkflow.indexOf('function runReportStage');
const reportStageEnd = compactWorkflow.indexOf('function runReportVerifier', reportStageStart);
const reportVerifierStart = compactWorkflow.indexOf('function runReportVerifier');
const reportVerifierEnd = compactWorkflow.indexOf('function runReportPublish', reportVerifierStart);
assert(reportStageStart >= 0 && reportStageEnd > reportStageStart, 'Workflow report generation block must have stable boundaries');
assert(reportVerifierStart >= 0 && reportVerifierEnd > reportVerifierStart, 'Workflow report verifier block must have stable boundaries');
const reportStageBlock = compactWorkflow.slice(reportStageStart, reportStageEnd);
const reportVerifierBlock = compactWorkflow.slice(reportVerifierStart, reportVerifierEnd);
assert(/stage\s*===\s*['"]L46['"]/.test(reportStageBlock) && reportStageBlock.includes('scripts/generate-stage-report-entry.ts'), 'Workflow must route L46 report generation through the explicit entry');
assert(reportStageBlock.includes("args: ['report:stage', '--', `--stage=${stage}`]"), 'Workflow must preserve the historical report generator path');
assert(/stage\s*===\s*['"]L46['"]/.test(reportVerifierBlock) && reportVerifierBlock.includes('scripts/verify-l46-report-publish-local.ts'), 'Workflow must route L46 through its strict publish gate');
assert(reportVerifierBlock.includes('scripts/verify-report-publish-local.ts'), 'Workflow must preserve the historical report publish verifier');
assert(workflowSource.includes('L46 tax-record DB scope verifier'), 'Workflow must preserve the stable L46 DB scope evidence title');
assert(workflowSource.includes('verification_source_commit:${currentHeadCommit()}'), 'Workflow must bind latest verify output to the current HEAD commit');

const publishSource = read('scripts/publish-stage-report.ts');
assert(publishSource.includes("if (stage === 'L46')") && publishSource.includes('scripts/generate-stage-report-entry.ts'), 'Publisher must regenerate L46 through the canonical entry');
assert(publishSource.includes('scripts/verify-l46-report-publish-local.ts'), 'Publisher must run the strict L46 gate before copying');
const publishMain = publishSource.slice(publishSource.indexOf('function main()'));
const regenerateIndex = publishMain.indexOf('runStageReport(stage);');
const verifyIndex = publishMain.indexOf('verifyStageReportBeforeCopy(stage);');
const copyIndex = publishMain.indexOf('copyReportFiles(');
assert(regenerateIndex >= 0 && verifyIndex > regenerateIndex && copyIndex > verifyIndex, 'Publisher must regenerate, verify, then copy the final L46 report');

const fixtureCommit = 'a'.repeat(40);
const transformedPass = transformL46Report(reportFixture(), completeVerifyOutput(fixtureCommit), fixtureCommit);
assert(transformedPass.includes('Codex 自评结论：passed'), 'Complete L46 evidence fixture must pass');
assert(!section(transformedPass, '## 5. 核心业务验收点', '## 6. 验收脚本').includes('- [ ]'), 'Complete L46 evidence fixture must check every checklist item');
assert(section(transformedPass, '## 10. 未完成项', '## 11. Codex 给人工 reviewer 的说明') === '暂无自动发现', 'Complete L46 evidence fixture must clear the generic unfinished placeholder');
assert(!section(transformedPass, '## 9. 风险点', '## 10. 未完成项').includes('需人工 review'), 'Complete L46 evidence fixture must clear generic risk placeholders');

const transformedCommitMismatch = transformL46Report(reportFixture(), completeVerifyOutput('b'.repeat(40)), fixtureCommit);
assert(transformedCommitMismatch.includes('Codex 自评结论：partial'), 'Evidence from another commit must remain partial');

const transformedPartial = transformL46Report(reportFixture(), completeVerifyOutput(fixtureCommit).replace('command_completed:raw compliance scan=true', ''), fixtureCommit);
assert(transformedPartial.includes('Codex 自评结论：partial'), 'Missing L46 evidence fixture must remain partial');
assert(section(transformedPartial, '## 5. 核心业务验收点', '## 6. 验收脚本').includes('- [ ] raw compliance scan'), 'Missing L46 evidence fixture must leave its checklist item unchecked');

const todoMarker = 'TO' + 'DO';
const transformedTodo = transformL46Report(reportFixture(`- apps/api/src/example.ts:1 — ${todoMarker}: unresolved`), completeVerifyOutput(fixtureCommit), fixtureCommit);
assert(transformedTodo.includes('Codex 自评结论：partial'), 'Real unfinished L46 work must keep the report partial');
assert(section(transformedTodo, '## 10. 未完成项', '## 11. Codex 给人工 reviewer 的说明').includes(`${todoMarker}: unresolved`), 'Real unfinished L46 work must be preserved');

const currentCommit = gitOutput(['rev-parse', 'HEAD']);
const verifyOutput = read('reports/latest-verify-output.txt');
assert(verificationSourceCommit(verifyOutput) === currentCommit, `L46 verification output must be bound to HEAD expected=${currentCommit} actual=${verificationSourceCommit(verifyOutput) ?? 'missing'}`);

execFileSync('pnpm', ['exec', 'tsx', 'scripts/generate-stage-report-entry.ts', '--stage=L46'], { stdio: 'pipe' });
const report = read('reports/stage-L46-report.md');
const definition = getStageDefinition('L46');
assert(definition, 'L46 must be registered');
const source = resolveReportSource('L46');
assert(source.sourceMode === 'git_diff', 'L46 report source must use git_diff');
assert(report.includes('- 阶段：L46'), 'L46 report must identify its stage');
assert(report.includes(`- 注册阶段标题：${definition.title}`), 'L46 report must use the registered title');
assert(report.includes(`- 本阶段目标：${definition.title}`), 'L46 report must use the registered goal');
assert(report.includes(`- 业务稳定分支：${source.businessBaseBranch}`), 'L46 report must use the resolved business base branch');
assert(report.includes(`- 业务稳定 commit：${source.businessBaseCommit}`), 'L46 report must use the resolved business base commit');
assert(report.includes(`- 报告生成 commit：${currentCommit}`), 'L46 report generation commit must equal HEAD');
assertSetEqual(gitDiffFiles(source.businessBaseCommit, 'HEAD'), extractMarkdownFilePaths(report), 'L46 report changed files');

assert(report.includes('Codex 自评结论：passed') && !report.includes('Codex 自评结论：partial'), 'L46 report conclusion must be passed');
const checklistSection = section(report, '## 5. 核心业务验收点', '## 6. 验收脚本');
assert(!checklistSection.includes('- [ ]'), 'L46 report checklist must not contain unchecked items');
for (const label of L46_REPORT_EVIDENCE_LABELS) {
  const checkedRows = checklistSection.split('\n').filter((line) => line.includes(`- [x] ${label}`));
  assert(checkedRows.length === 1, `L46 report checklist must contain one checked item: ${label}`);
}

const verificationSection = section(report, '## 7. 阶段验证执行结果', '## 8. 合规边界检查');
for (const label of L46_REPORT_EVIDENCE_LABELS) {
  const matchingRows = verificationSection.split('\n').filter((line) => line.includes(`| ${label} |`));
  assert(matchingRows.length === 1 && matchingRows[0].includes(`| ${label} | passed |`), `L46 report verification row must pass: ${label}`);
}
const riskSection = section(report, '## 9. 风险点', '## 10. 未完成项');
assert(riskSection.includes('- 高风险：暂无自动发现') && riskSection.includes('- 中风险：暂无自动发现'), 'L46 report risks must be normalized after complete evidence');
assert(!riskSection.includes('需人工 review'), 'L46 report risks must not retain generic manual-review placeholders');
assert(section(report, '## 10. 未完成项', '## 11. Codex 给人工 reviewer 的说明') === '暂无自动发现', 'L46 report unfinished section must be empty');
assert(!report.includes('undefined'), 'L46 report must not contain undefined');

console.log('Report publish verification passed.');
