import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type EvidenceStatus = 'passed' | 'failed' | 'not detected';
export type EvidenceRow = { command: string; result: EvidenceStatus };

export const L46_REPORT_EVIDENCE_LABELS = [
  'L46 verifier',
  'L46 tax-record DB scope verifier',
  'L24-L46 chain regression',
  'Docker API E2E',
  'Admin typecheck config',
  'Admin full typecheck',
  'raw compliance scan',
  'Stage workflow',
] as const;

function hasExplicitFailure(content: string): boolean {
  return [
    'ERR_PNPM',
    'Command failed',
    'ELIFECYCLE',
    'failed with exit code',
    'exit code 1',
    'exit code 2',
    'MODULE_NOT_FOUND',
    'TypeScript error TS',
    'PrismaClientKnownRequestError',
    'ReferenceError',
  ].some((marker) => content.includes(marker)) || /\berror TS\d{4}\b/.test(content);
}

function completed(content: string, title: string): EvidenceStatus {
  if (content.includes(`command_completed:${title}=true`)) return 'passed';
  return hasExplicitFailure(content) ? 'failed' : 'not detected';
}

function chainCompleted(content: string): EvidenceStatus {
  if (
    content.includes('command_completed:L24-L46 chain regression=true') &&
    content.includes('L24-L46 chain regression passed.')
  ) {
    return 'passed';
  }
  return hasExplicitFailure(content) ? 'failed' : 'not detected';
}

export function l46EvidenceRows(content: string): EvidenceRow[] {
  return [
    { command: 'L46 verifier', result: completed(content, 'L46 verifier') },
    { command: 'L46 tax-record DB scope verifier', result: completed(content, 'L46 tax-record DB scope verifier') },
    { command: 'L24-L46 chain regression', result: chainCompleted(content) },
    { command: 'Docker API E2E', result: completed(content, 'Docker API E2E') },
    { command: 'Admin typecheck config', result: completed(content, 'Admin typecheck config check') },
    { command: 'Admin full typecheck', result: completed(content, 'Admin typecheck') },
    { command: 'raw compliance scan', result: completed(content, 'raw compliance scan') },
    { command: 'Stage workflow', result: completed(content, 'Stage workflow') },
  ];
}

function replaceSection(report: string, startHeader: string, endHeader: string, replacement: string): string {
  const start = report.indexOf(startHeader);
  const end = report.indexOf(endHeader, start);
  if (start < 0 || end <= start) {
    throw new Error(`L46 report section boundaries are missing: ${startHeader} -> ${endHeader}`);
  }
  return `${report.slice(0, start)}${replacement}\n\n${report.slice(end)}`;
}

function renderChecklistSection(rows: EvidenceRow[]): string {
  return [
    '## 5. 核心业务验收点',
    '',
    ...rows.map((row) => `- [${row.result === 'passed' ? 'x' : ' '}] ${row.command}（machine evidence: ${row.result}）`),
  ].join('\n');
}

function renderEvidenceSection(rows: EvidenceRow[]): string {
  return [
    '## 7. 阶段验证执行结果',
    '',
    '| 命令 | 结果 |',
    '|---|---|',
    ...rows.map((row) => `| ${row.command} | ${row.result} |`),
  ].join('\n');
}

function unfinishedSection(report: string): string {
  return report.split('## 10. 未完成项')[1]?.split('## 11. Codex 给人工 reviewer 的说明')[0]?.trim() ?? '';
}

function normalizeUnfinishedSection(report: string, allPassed: boolean): string {
  const current = unfinishedSection(report);
  if (!allPassed) return report;
  if (current !== '暂无自动发现' && current !== '暂无自动发现，需人工 review') return report;
  return replaceSection(report, '## 10. 未完成项', '## 11. Codex 给人工 reviewer 的说明', '## 10. 未完成项\n\n暂无自动发现');
}

export function transformL46Report(report: string, verifyOutput: string): string {
  const rows = l46EvidenceRows(verifyOutput);
  const allPassed = rows.length === L46_REPORT_EVIDENCE_LABELS.length && rows.every((row) => row.result === 'passed');

  let updated = replaceSection(report, '## 5. 核心业务验收点', '## 6. 验收脚本', renderChecklistSection(rows));
  updated = replaceSection(updated, '## 7. 阶段验证执行结果', '## 8. 合规边界检查', renderEvidenceSection(rows));
  updated = normalizeUnfinishedSection(updated, allPassed);

  const noUnfinishedItems = unfinishedSection(updated) === '暂无自动发现';
  const conclusion = allPassed && noUnfinishedItems ? 'passed' : 'partial';
  if (!/- Codex 自评结论：(passed|partial)/.test(updated)) {
    throw new Error('L46 report conclusion line is missing');
  }
  updated = updated.replace(/- Codex 自评结论：(passed|partial)/, `- Codex 自评结论：${conclusion}`);

  if (updated.includes('undefined')) throw new Error('L46 report evidence transform produced undefined');
  return updated;
}

export function applyL46ReportEvidence(): void {
  const reportsDir = join(process.cwd(), 'reports');
  const verifyPath = join(reportsDir, 'latest-verify-output.txt');
  const reportPath = join(reportsDir, 'stage-L46-report.md');
  if (!existsSync(reportPath)) {
    throw new Error('L46 report evidence transform could not find reports/stage-L46-report.md');
  }
  const verifyOutput = existsSync(verifyPath) ? readFileSync(verifyPath, 'utf8') : '';
  const report = readFileSync(reportPath, 'utf8');
  writeFileSync(reportPath, transformL46Report(report, verifyOutput));
}
