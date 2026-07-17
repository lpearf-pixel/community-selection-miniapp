import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type EvidenceStatus = 'passed' | 'failed' | 'not detected';
type EvidenceRow = { command: string; result: EvidenceStatus };

function stageArg(argv: string[]): string | undefined {
  const inline = argv.find((arg) => arg.startsWith('--stage='));
  if (inline) return inline.slice('--stage='.length);
  const index = argv.indexOf('--stage');
  return index >= 0 ? argv[index + 1] : undefined;
}

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

function renderEvidenceSection(rows: EvidenceRow[]): string {
  return [
    '## 7. 阶段验证执行结果',
    '',
    '| 命令 | 结果 |',
    '|---|---|',
    ...rows.map((row) => `| ${row.command} | ${row.result} |`),
  ].join('\n');
}

function unfinishedItemsAreClear(report: string): boolean {
  const section = report.split('## 10. 未完成项')[1]?.split('## 11. Codex 给人工 reviewer 的说明')[0]?.trim() ?? '';
  return section === '暂无自动发现' || section === '暂无自动发现，需人工 review';
}

function applyL46Evidence(): void {
  const reportsDir = join(process.cwd(), 'reports');
  const verifyPath = join(reportsDir, 'latest-verify-output.txt');
  const reportPath = join(reportsDir, 'stage-L46-report.md');
  if (!existsSync(reportPath)) throw new Error('L46 report evidence hook could not find reports/stage-L46-report.md');
  const verifyOutput = existsSync(verifyPath) ? readFileSync(verifyPath, 'utf8') : '';
  const report = readFileSync(reportPath, 'utf8');
  const sectionStart = report.indexOf('## 7. 阶段验证执行结果');
  const sectionEnd = report.indexOf('## 8. 合规边界检查', sectionStart);
  if (sectionStart < 0 || sectionEnd <= sectionStart) throw new Error('L46 report evidence section boundaries are missing');
  const rows = l46EvidenceRows(verifyOutput);
  const allPassed = rows.every((row) => row.result === 'passed');
  const conclusion = allPassed && unfinishedItemsAreClear(report) ? 'passed' : 'partial';
  let updated = `${report.slice(0, sectionStart)}${renderEvidenceSection(rows)}\n\n${report.slice(sectionEnd)}`;
  if (!/- Codex 自评结论：(passed|partial)/.test(updated)) throw new Error('L46 report conclusion line is missing');
  updated = updated.replace(/- Codex 自评结论：(passed|partial)/, `- Codex 自评结论：${conclusion}`);
  writeFileSync(reportPath, updated);
}

export function installL46ReportEvidenceHook(): void {
  const entry = (process.argv[1] ?? '').replace(/\\/g, '/');
  if (!entry.endsWith('/scripts/generate-stage-report.ts') && !entry.endsWith('scripts/generate-stage-report.ts')) return;
  if (stageArg(process.argv.slice(2))?.trim().toUpperCase() !== 'L46') return;
  let applied = false;
  process.once('beforeExit', () => {
    if (applied) return;
    applied = true;
    applyL46Evidence();
  });
}
