import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const L45_PUSH_COMMAND = 'scripts/stage-workflow.ts --stage=L45 --publish --scope=chain --push';
const L45_NO_PUSH_COMMAND = 'scripts/stage-workflow.ts --stage=L45 --publish --scope=chain';

const L46_DASHBOARD_PERMISSION = 'operations.view/order.view/pickup.verify/after_sale.manage/product.manage OR finance.view/refund.view/reward.view/withdrawal.view + admin data scope';

function replaceSection(report: string, startHeader: string, endHeader: string, replacement: string): string {
  const start = report.indexOf(startHeader);
  const end = report.indexOf(endHeader, start);
  if (start < 0 || end <= start) throw new Error(`Report section boundaries are missing: ${startHeader} -> ${endHeader}`);
  return `${report.slice(0, start)}${replacement}\n\n${report.slice(end)}`;
}

export function normalizeL45ReportArtifact(report: string): string {
  const updated = report.split(L45_PUSH_COMMAND).join(L45_NO_PUSH_COMMAND);
  if (updated.includes(L45_PUSH_COMMAND)) throw new Error('L45 report must not claim that --push was executed');
  return updated;
}

export function normalizeL46ReportArtifact(report: string): string {
  const apiSection = [
    '## 3. API 变化',
    '',
    '| 方法 | 路径 | 权限 | 用途 | 是否有验收 |',
    '|---|---|---|---|---|',
    `| GET | /api/admin/dashboard-v2/overview | ${L46_DASHBOARD_PERMISSION} | 经营总览与 Operations/Finance 分区指标 | yes |`,
    `| GET | /api/admin/dashboard-v2/trends | ${L46_DASHBOARD_PERMISSION} | 按自然日聚合的经营趋势 | yes |`,
    `| GET | /api/admin/dashboard-v2/alerts | ${L46_DASHBOARD_PERMISSION} | 只读经营风险提醒 | yes |`,
  ].join('\n');
  return replaceSection(report, '## 3. API 变化', '## 4. 数据库变化', apiSection);
}

export function normalizeStageReportArtifact(stage: string, report: string): string {
  if (stage === 'L45') return normalizeL45ReportArtifact(report);
  if (stage === 'L46') return normalizeL46ReportArtifact(report);
  return report;
}

export function applyStageReportArtifactNormalization(stage: string): void {
  if (stage !== 'L45' && stage !== 'L46') return;
  const reportPath = join(process.cwd(), 'reports', `stage-${stage}-report.md`);
  if (!existsSync(reportPath)) throw new Error(`Report artifact normalization could not find ${reportPath}`);
  const report = readFileSync(reportPath, 'utf8');
  writeFileSync(reportPath, normalizeStageReportArtifact(stage, report));
}
