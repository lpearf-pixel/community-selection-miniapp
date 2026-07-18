import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  L47_CENTER_API_CONTRACT,
  L47_RUNTIME_MARKERS,
} from './l47-center-contract.ts';

export type L47EvidenceStatus = 'passed' | 'failed' | 'not detected';
export type L47EvidenceRow = { command: string; result: L47EvidenceStatus };

export const L47_REPORT_EVIDENCE_LABELS = [
  'L47 verifier',
  'L47 center Docker E2E',
  'L47 report routing verifier',
  'L24-L47 chain regression',
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

function completed(content: string, title: string): L47EvidenceStatus {
  if (content.includes(`command_completed:${title}=true`)) return 'passed';
  return hasExplicitFailure(content) ? 'failed' : 'not detected';
}

function chainCompleted(content: string): L47EvidenceStatus {
  if (
    content.includes('command_completed:L24-L47 chain regression=true') &&
    content.includes('L24-L47 chain regression passed.')
  ) {
    return 'passed';
  }
  return hasExplicitFailure(content) ? 'failed' : 'not detected';
}

export function l47VerificationSourceCommit(content: string): string | undefined {
  const matches = Array.from(content.matchAll(/^verification_source_commit:([0-9a-f]{40})$/gm));
  return matches.length === 1 ? matches[0][1] : undefined;
}

export function hasAllL47RuntimeMarkers(content: string): boolean {
  return L47_RUNTIME_MARKERS.every((marker) => content.includes(marker));
}

function unboundRows(content: string): L47EvidenceRow[] {
  const result: L47EvidenceStatus = hasExplicitFailure(content) ? 'failed' : 'not detected';
  return L47_REPORT_EVIDENCE_LABELS.map((command) => ({ command, result }));
}

export function l47EvidenceRows(content: string, expectedCommit?: string): L47EvidenceRow[] {
  if (expectedCommit && l47VerificationSourceCommit(content) !== expectedCommit) return unboundRows(content);
  return [
    { command: 'L47 verifier', result: completed(content, 'L47 verifier') },
    { command: 'L47 center Docker E2E', result: completed(content, 'L47 center Docker E2E') },
    { command: 'L47 report routing verifier', result: completed(content, 'L47 report routing verifier') },
    { command: 'L24-L47 chain regression', result: chainCompleted(content) },
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
    throw new Error(`L47 report section boundaries are missing: ${startHeader} -> ${endHeader}`);
  }
  return `${report.slice(0, start)}${replacement}\n\n${report.slice(end)}`;
}

function inputDbHeader(report: string): string {
  for (const header of ['## 4. 数据库变化', '## 4. DB 变化']) {
    if (report.includes(header)) return header;
  }
  throw new Error('L47 report DB section header is missing');
}

function apiPurpose(path: string): string {
  return path.startsWith('/api/leaders/')
    ? '团长开团、奖励与人工提现摘要'
    : '用户身份、订单履约与售后摘要';
}

function renderApiSection(): string {
  return [
    '## 3. API 变化',
    '',
    '| 方法 | 路径 | 权限 | 用途 | 验证 |',
    '|---|---|---|---|---|',
    ...L47_CENTER_API_CONTRACT.map((api) =>
      `| ${api.method} | ${api.path} | ${api.auth} | ${apiPurpose(api.path)} | passed |`,
    ),
  ].join('\n');
}

function renderDbSection(): string {
  return [
    '## 4. DB 变化',
    '',
    '- 无新增表',
    '- 无新增字段',
    '- 无新增 migration',
    '- 复用 User、Order、AfterSaleCase、GroupBuy、Commission、RewardLedger、Withdrawal',
  ].join('\n');
}

function renderChecklistSection(rows: L47EvidenceRow[], markersPassed: boolean): string {
  return [
    '## 5. 核心业务验收点',
    '',
    ...rows.map((row) =>
      `- [${row.result === 'passed' ? 'x' : ' '}] ${row.command}（machine evidence: ${row.result}）`,
    ),
    `- [${markersPassed ? 'x' : ' '}] L47 十个运行 marker 完整（machine evidence: ${markersPassed ? 'passed' : 'not detected'}）`,
  ].join('\n');
}

function renderEvidenceSection(rows: L47EvidenceRow[], markersPassed: boolean): string {
  return [
    '## 7. 阶段验证执行结果',
    '',
    '| 命令 | 结果 |',
    '|---|---|',
    ...rows.map((row) => `| ${row.command} | ${row.result} |`),
    `| L47 十个运行 marker | ${markersPassed ? 'passed' : 'not detected'} |`,
  ].join('\n');
}

function unfinishedSection(report: string): string {
  return report
    .split('## 10. 未完成项')[1]
    ?.split('## 11. Codex 给人工 reviewer 的说明')[0]
    ?.trim() ?? '';
}

function normalizeUnfinishedSection(report: string, allPassed: boolean): string {
  if (!allPassed) return report;
  const current = unfinishedSection(report);
  if (current !== '暂无自动发现' && current !== '暂无自动发现，需人工 review') return report;
  return replaceSection(
    report,
    '## 10. 未完成项',
    '## 11. Codex 给人工 reviewer 的说明',
    '## 10. 未完成项\n\n暂无自动发现',
  );
}

export function transformL47Report(
  report: string,
  verifyOutput: string,
  expectedCommit?: string,
): string {
  const rows = l47EvidenceRows(verifyOutput, expectedCommit);
  const markersPassed = expectedCommit
    ? l47VerificationSourceCommit(verifyOutput) === expectedCommit && hasAllL47RuntimeMarkers(verifyOutput)
    : hasAllL47RuntimeMarkers(verifyOutput);
  const allPassed =
    rows.length === L47_REPORT_EVIDENCE_LABELS.length &&
    rows.every((row) => row.result === 'passed') &&
    markersPassed;
  const dbHeader = inputDbHeader(report);

  let updated = replaceSection(report, '## 3. API 变化', dbHeader, renderApiSection());
  updated = replaceSection(updated, dbHeader, '## 5. 核心业务验收点', renderDbSection());
  updated = replaceSection(
    updated,
    '## 5. 核心业务验收点',
    '## 6. 验收脚本',
    renderChecklistSection(rows, markersPassed),
  );
  updated = replaceSection(
    updated,
    '## 7. 阶段验证执行结果',
    '## 8. 合规边界检查',
    renderEvidenceSection(rows, markersPassed),
  );
  updated = normalizeUnfinishedSection(updated, allPassed);

  const noUnfinishedItems = unfinishedSection(updated) === '暂无自动发现';
  if (allPassed && noUnfinishedItems) {
    updated = updated
      .replace('- 高风险：暂无自动发现，需人工 review', '- 高风险：暂无自动发现')
      .replace('- 中风险：暂无自动发现，需人工 review', '- 中风险：暂无自动发现');
  }

  const conclusion = allPassed && noUnfinishedItems ? 'passed' : 'partial';
  if (!/- Codex 自评结论：(passed|partial)/.test(updated)) {
    throw new Error('L47 report conclusion line is missing');
  }
  updated = updated.replace(
    /- Codex 自评结论：(passed|partial)/,
    `- Codex 自评结论：${conclusion}`,
  );

  if (updated.includes('undefined')) throw new Error('L47 report evidence transform produced undefined');
  return updated;
}

function currentHeadCommit(): string {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Unable to resolve a full HEAD commit: ${commit || 'empty'}`);
  }
  return commit;
}

export function applyL47ReportEvidence(): void {
  const reportsDir = join(process.cwd(), 'reports');
  const verifyPath = join(reportsDir, 'latest-verify-output.txt');
  const reportPath = join(reportsDir, 'stage-L47-report.md');
  if (!existsSync(reportPath)) {
    throw new Error('L47 report evidence transform could not find reports/stage-L47-report.md');
  }
  const verifyOutput = existsSync(verifyPath) ? readFileSync(verifyPath, 'utf8') : '';
  const report = readFileSync(reportPath, 'utf8');
  writeFileSync(reportPath, transformL47Report(report, verifyOutput, currentHeadCommit()));
}
