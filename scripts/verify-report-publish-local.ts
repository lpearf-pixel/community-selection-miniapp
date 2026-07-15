import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { l45ConcurrentRuntimeMarkers } from './l45-api-contract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string) {
  return readFileSync(path, 'utf8');
}


function gitOutput(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitDiffFiles(base: string, head: string) {
  const output = gitOutput(['diff', '--name-only', `${base}...${head}`]);
  return Array.from(new Set(output.split('\n').map((line) => line.trim()).filter(Boolean))).sort();
}

function extractMarkdownFilePaths(report: string) {
  const section = report.split('## 2. 本阶段变更范围')[1]?.split('## 3. API 变化')[0] ?? '';
  const files: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const file = cells[1];
    if (file === '文件' || file === '---') continue;
    if (file.includes('/') || file === 'docker-compose.yml') files.push(file);
  }
  return Array.from(new Set(files)).sort();
}


function isFixtureTodoScannerImplementationLine(file: string, lineNumber: number, sourceLines: string[]) {
  if (file !== 'scripts/generate-stage-report.ts') return false;
  const functionNames = ['isAllowedPlaceholderLine', 'isTodoScannerImplementationLine', 'isTodoScannerDefinition', 'isVerifierTodoTestString', 'findTodoItems'];
  for (const functionName of functionNames) {
    const start = sourceLines.findIndex((line) => line.includes(`function ${functionName}`));
    if (start < 0) continue;
    const nextFunction = sourceLines.findIndex((line, index) => index > start && /^function\s+\w+/.test(line.trim()));
    const end = nextFunction >= 0 ? nextFunction : sourceLines.length;
    if (lineNumber >= start && lineNumber < end) return true;
  }
  return false;
}

function fixtureTodoItems(file: string, source: string) {
  const todoKeyword = 'TO' + 'DO';
  const fixmeKeyword = 'FIX' + 'ME';
  const tbdKeyword = 'T' + 'BD';
  const notImplementedKeyword = 'NOT_' + 'IMPLEMENTED';
  const pendingCn = '待' + '实现';
  const placeholderCn = '功能' + '占位';
  const todoKeywords = new RegExp(`(${todoKeyword}:|${fixmeKeyword}:|${tbdKeyword}:|${notImplementedKeyword}|throw new Error\([\`'"]Not implemented[\`'"]\)|${pendingCn}|${placeholderCn})`, 'i');
  const lines = source.split('\n');
  const rows: string[] = [];
  lines.forEach((line, index) => {
    if (isFixtureTodoScannerImplementationLine(file, index, lines)) return;
    if (/verify.*\.(ts|tsx|js)$/.test(file) && todoKeywords.test(line) && /assert|includes|keywords|forbidden|required/.test(line)) return;
    if (todoKeywords.test(line)) rows.push(`${file}:${index + 1} — ${line.trim()}`);
  });
  return rows;
}

function assertSetEqual(expected: string[], actual: string[], label: string) {
  const missing = expected.filter((file) => !actual.includes(file));
  const extra = actual.filter((file) => !expected.includes(file));
  assert(missing.length === 0 && extra.length === 0, `${label} mismatch. missing=${missing.join(',')} extra=${extra.join(',')}`);
}

const generatePath = 'scripts/generate-stage-report.ts';
const publishPath = 'scripts/publish-stage-report.ts';
const docsPath = 'docs/dev/reporting.md';
const verifyAllPath = 'scripts/verify-all-local.sh';

assert(existsSync(generatePath), 'generate-stage-report.ts should exist');
assert(existsSync(publishPath), 'publish-stage-report.ts should exist');
assert(existsSync(docsPath), 'docs/dev/reporting.md should exist');

const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(packageJson.scripts?.['report:stage'] === 'tsx scripts/generate-stage-report.ts', 'package.json should expose report:stage');
assert(packageJson.scripts?.['report:publish'] === 'tsx scripts/publish-stage-report.ts', 'package.json should expose report:publish');

const publishSource = read(publishPath);
for (const required of ['stage-reports', 'worktree', 'latest.md', 'latest-verify-output.txt', 'metadata.json', '--push', '--no-push', 'git fetch origin', 'git pull --ff-only', 'rev-list --left-right --count', '--pull-source', '--skip-source-sync-check', 'origin/stage-reports', 'beforePullCommit', 'afterPullCommit', '已有 reports/latest-verify-output.txt 可能对应旧 commit', '重新运行 verify', 'beforePullCommit !== afterPullCommit']) {
  assert(publishSource.includes(required), `publish script should include ${required}`);
}
assert(!publishSource.includes('git checkout stage-reports'), 'publish script must not directly checkout the report branch in the current worktree');
assert(!publishSource.includes('git switch stage-reports'), 'publish script must not directly switch the current worktree');
assert(!publishSource.includes('push --force'), 'publish script must not force push');
assert(!publishSource.includes('push -f'), 'publish script must not force push');

const generateSource = read(generatePath);
for (const required of [
  'type StageManifestChecklistItem',
  'stage checklist item',
  'generated report contains forbidden string: undefined',
  'Admin 订单详情接口返回订单金额、退款拆分、剩余可退金额和配送摘要。',
  'L40 verifier',
  'L41 verifier',
  'L42 verifier',
  'L43 verifier',
  'L24-L40 chain regression',
  'L24-L41 chain regression',
  'L24-L42 chain regression',
  'Docker API E2E',
  'Admin typecheck config',
  'Admin full typecheck',
  'Admin typecheck passed.',
  "commandSection(content, 'Admin typecheck')",
  'detectAdminTypecheck',
  'hasExplicitFailure',
  'commandPassed',
  'isTodoScannerDefinition',
  'isTodoScannerImplementationLine',
  'L42 business base branch must be configured',
  'error TS',
  'raw compliance scan',
  'raw compliance scan passed.',
  'commandPassedInSectionOnly',
  'assertChangedFileCoverage',
  'expectedCoreFiles',
  '--name-only',
  'Stage report changed-file coverage mismatch',
  '202607130001_l43_reward_ledger_t7_refund_deduct',
  '202607130002_l43_reward_ledger_t3_refund_deduct',
  'review_status, review_note, reviewed_by_admin_id, reviewed_at, last_adjusted_at',
  'idempotency_key, event_type, affects_available_balance, effective_at, refund_id',
  'Stage workflow',
  'placeholder\\s*=',
  'placeholder-not-for-login',
  'businessBaseBranch',
  'stable/l40-business-base',
  'stable/l41-business-base',
  'businessBaseCommit',
  '429fe77c104f26e8f0a886727e7ee09902bcca4b',
  '7af8cb37b3c0babefe70900b27e3f85ed84caaec',
  'c56f72cdf8fbc283bab694cc410a5415d3d0cf42',
  '报告生成分支',
  '报告生成 commit',
  'order.view',
  "permissions: ['after_sale.manage', 'refund.manage']",
  "permissions: ['refund.view','refund.manage']",
  "api.permissions.join(' + ')"
]) {
  assert(generateSource.includes(required), `generate script should include ${required}`);
}
assert(!generateSource.includes("permission: 'L40 admin permission'"), 'L40 report must not use generic admin permission text');
assert(!generateSource.includes("({ item, status: 'passed'"), 'L40 checklist must not use item/status shape that renders undefined');
assert(!generateSource.includes('/\\bfailed\\b/i.test'), 'stage report must not treat the business word failed as a failure marker');
assert(generateSource.includes('detectAdminTypecheck(content)'), 'L43 report must use detectAdminTypecheck(content)');
assert(!generateSource.includes('parseAdminTypecheck(content)'), 'generate-stage-report must not call undefined parseAdminTypecheck(content)');
assert(!generateSource.includes('l43Manifest.files'), 'L43 report generator must not use l43Manifest.files as changed-file source');
assert(generateSource.includes('git') && generateSource.includes('diff') && generateSource.includes('--name-only') && generateSource.includes('...HEAD'), 'L43 report generator must use real git diff changed files');
assert(generateSource.includes('Commission') && generateSource.includes('review_status') && generateSource.includes('last_adjusted_at'), 'L43 report must describe Commission concrete fields');

for (const required of ['L44 manual withdrawal review workbench','stable/l43-business-base','72a84e81218845c23872bd91ab58a03ccf4c0f33','WithdrawalCommission','GET', '/api/admin/withdrawals/:id', 'withdrawal.view + data scope', 'withdrawal.manage + data scope', 'hasL44RuntimeMarkers']) {
  assert(generateSource.includes(required), `L44 report generator should include ${required}`);
}
for (const required of ['isL45Stage', 'L45 manual tax review and internal CSV export', 'stable/l44-business-base', '3ae666ec0e26383a5b117b64dce30b86a2dee389', 'withdrawal.manage + data scope', '无新增表', '无新增字段', '复用 Withdrawal', '复用 WithdrawalCommission', '复用 TaxRecord', '复用 AdminAuditLog', '复用 BusinessEventLog', 'L24-L45 chain regression', 'runtime_markers_required', 'l45TaxReviewConcurrentScenario', 'l45_tax_detail_success=true', 'l45_tax_export_over_limit_http_422=true', 'l45_tax_review_stale_version_409=true', 'l45_mark_paid_rollback_verified=true']) {
  assert(generateSource.includes(required), `L45 report generator should include ${required}`);
}
assert(!generateSource.includes("permissions: ['public']"), 'L44 report permissions must not be public');
const l45ContractSource = read('scripts/l45-api-contract.ts');
for (const required of ['tax_record_list','tax_record_detail','tax_record_export','tax_review','mark_paid','fulfilled_count','applied_count','idempotent_count','runtime_markers_required','l45_tax_review_stale_version_409=true','l45_mark_paid_rollback_verified=true']) assert(l45ContractSource.includes(required), `L45 machine contract missing ${required}`);
assert(l45ConcurrentRuntimeMarkers().every((marker) => generateSource.includes('l45ConcurrentRuntimeMarkers') || l45ContractSource.includes(marker.split('=')[0])), 'L45 report verifier must share concurrent marker helper semantics');
const dockerE2eSource = read('scripts/verify-docker-api-e2e-local.ts');
assert(!dockerE2eSource.includes('const l44RuntimeEvidence'), 'L44 Docker E2E must not use hardcoded evidence object');
for (const required of ['=== L44 leader identity scenario ===','l44_creation_scenario_passed','Promise.allSettled','/api/leaders/me/withdrawals','/api/admin/withdrawals/','prisma.withdrawal','prisma.withdrawalCommission','prisma.rewardLedger','prisma.businessEventLog','getAvailableRewardBalance']) {
  assert(dockerE2eSource.includes(required), `L44 Docker E2E should include real runtime evidence: ${required}`);
}
for (const required of ['runL45TaxReviewScenario', 'POST /api/admin/withdrawals/:id/tax-review', 'Promise.allSettled', 'prisma.withdrawal', 'prisma.taxRecord', 'prisma.adminAuditLog', 'prisma.businessEventLog', 'financeNoScopeHeaders', 'fixtureB', 'negative taxable', '=HYPERLINK', '+SUM(1,1)', '@cmd', '-1+2', 'l45_csv_formula_safe', 'l45_tax_detail_success=true', 'l45_tax_export_over_limit_http_422=true', 'none nonzero tax', 'l45_tax_review_stale_version_409=true', 'l45_tax_review_terminal_replay=true', 'l45_tax_review_invalid_same_key_400=true', 'l45_tax_review_valid_same_key_409=true', 'l45_mark_paid_rollback_verified=true']) {
  assert(dockerE2eSource.includes(required), `L45 Docker E2E should include real runtime evidence: ${required}`);
}


assert(generateSource.includes('RewardLedger') && generateSource.includes('idempotency_key') && generateSource.includes('affects_available_balance'), 'L43 report must describe RewardLedger concrete fields');
assert(!generateSource.includes("change: 'L43 manifest'"), 'L43 DB rows must not use L43 manifest placeholders');
assert(generateSource.includes('todos.length === 0'), 'passed report must require todos.length === 0');
assert(generateSource.includes('passed report cannot contain unfinished items'), 'passed report must reject unfinished items');
for (const permissionText of ['leader self', 'reward.view', 'reward.manage', 'super_admin global']) {
  assert(generateSource.includes(permissionText), `L43 report permissions should include ${permissionText}`);
}
for (const forbiddenPermission of ['public', 'admin session', 'unknown']) {
  assert(!generateSource.includes(`permission: '${forbiddenPermission}'`) && !generateSource.includes(`permissions: ['${forbiddenPermission}']`), `L43 report permissions must not include ${forbiddenPermission}`);
}
assert(publishSource.includes('--orphan'), 'publish script may initialize the report branch through an orphan worktree');

const reportingDocs = read(docsPath);
for (const required of ['git fetch origin', 'git pull --ff-only', 'pnpm verify:all', 'pnpm report:publish', '--pull-source', '如果它实际拉取了新 commit', '脚本会中止', '重新运行 verify:all', '更推荐先手动 git pull']) {
  assert(reportingDocs.includes(required), `reporting docs should include ${required}`);
}

const verifyAll = read(verifyAllPath);
assert(verifyAll.includes('pnpm exec tsx scripts/verify-report-publish-local.ts'), 'verify-all should include report publish verifier');

const l43BaseCommit = '20d5023f0e493bad7485e4fe8cbc5ccba014e118';
execFileSync(process.execPath, ['scripts/generate-stage-report.ts', '--stage=L43'], { stdio: 'pipe' });
const l43Report = read('reports/stage-L43-report.md');
const expectedFiles = gitDiffFiles(l43BaseCommit, 'HEAD');
const reportFiles = extractMarkdownFilePaths(l43Report);
assertSetEqual(expectedFiles, reportFiles, 'L43 report changed files');
assert(l43Report.includes(`业务稳定 commit：${l43BaseCommit}`), 'L43 report must include base commit');
assert(l43Report.includes(`报告生成 commit：${gitOutput(['rev-parse', 'HEAD'])}`), 'L43 report source commit must equal HEAD');
for (const required of ['prisma/migrations/202607130001_l43_reward_ledger_t7_refund_deduct/migration.sql', 'prisma/migrations/202607130002_l43_reward_ledger_t3_refund_deduct/migration.sql', 'review_status', 'last_adjusted_at', 'idempotency_key', 'affects_available_balance', 'original_key:legacy:{ledger.id}']) {
  assert(l43Report.includes(required), `L43 report should include ${required}`);
}
assert(!l43Report.includes('Commission | L43 manifest'), 'L43 report must not contain Commission manifest placeholder');
assert(!l43Report.includes('RewardLedger | L43 manifest'), 'L43 report must not contain RewardLedger manifest placeholder');

const scannerDefinitionFixture = `
function isVerifierTodoTestString(
  file: string,
  line: string
) {
  return /${'TO' + 'DO'}|${'FIX' + 'ME'}|${'T' + 'BD'}|${'NOT_' + 'IMPLEMENTED'}/.test(line);
}
`;
assert(fixtureTodoItems('scripts/generate-stage-report.ts', scannerDefinitionFixture).length === 0, 'TODO scanner implementation fixture must not be reported as unfinished');

const realTodoFixture = `
export function calculateReward() {
  // ${'TO' + 'DO'}: implement reward calculation
}
`;
assert(fixtureTodoItems('apps/api/src/services/reward-example.ts', realTodoFixture).length === 1, 'real business TODO fixture must be reported as unfinished');

const verifierFixture = `
assert(
  !source.includes('${'TO' + 'DO'}'),
  'runtime source must not contain ${'TO' + 'DO'}'
);
`;
assert(fixtureTodoItems('scripts/verify-example-local.ts', verifierFixture).length === 0, 'verifier TODO assertion fixture must not be reported as unfinished');


const l44BaseCommit = '72a84e81218845c23872bd91ab58a03ccf4c0f33';
const l44Head = gitOutput(['rev-parse', 'HEAD']);
execFileSync('git', ['merge-base', '--is-ancestor', l44BaseCommit, l44Head], { stdio: 'pipe' });
const l44MergeBase = gitOutput(['merge-base', l44BaseCommit, l44Head]);
assert(l44MergeBase === l44BaseCommit, ['L44 report source must actually descend from business base', `base=${l44BaseCommit}`, `head=${l44Head}`, `merge_base=${l44MergeBase}`].join(' '));
const l44VerifyOutputPath = 'reports/latest-verify-output.txt';
assert(existsSync(l44VerifyOutputPath), 'L44 report verifier requires reports/latest-verify-output.txt from the completed L44 chain');
execFileSync(process.execPath, ['scripts/generate-stage-report.ts', '--stage=L44'], { stdio: 'pipe' });
const l44Report = read('reports/stage-L44-report.md');
const l44ExpectedFiles = gitDiffFiles(l44BaseCommit, 'HEAD');
const l44ReportFiles = extractMarkdownFilePaths(l44Report);
assertSetEqual(l44ExpectedFiles, l44ReportFiles, 'L44 report changed files');
assert(l44Report.includes(`业务稳定 commit：${l44BaseCommit}`), 'L44 report must include the L43 merge commit as business base');
assert(l44Report.includes(`报告生成 commit：${gitOutput(['rev-parse', 'HEAD'])}`), 'L44 report source commit must equal HEAD');
assert(l44Report.includes('Codex 自评结论：passed'), 'L44 report conclusion must be passed');
assert(!l44Report.includes('Codex 自评结论：partial'), 'L44 report must not be partial');
assert(!l44Report.includes('数据库变化：无'), 'L44 report must not say database changes are empty');
assert(l44ReportFiles.length === l44ExpectedFiles.length && l44ReportFiles.length > 8, 'L44 report must include the complete PR changed-file diff, not just verifier files');
for (const requiredFile of ['prisma/schema.prisma','prisma/migrations/20260714000100_l44_manual_withdrawal_review/migration.sql','prisma/migrations/20260714000200_l44_withdrawal_commission_links/migration.sql','apps/api/src/routes/withdrawals.ts','apps/admin/src/pages/withdrawals/WithdrawalReviewPage.tsx','apps/miniapp/pages/leader/withdrawals/index.js','scripts/verify-l44-manual-withdrawal-review-local.ts','scripts/verify-docker-api-e2e-local.ts']) {
  assert(l44ReportFiles.includes(requiredFile), `L44 report missing expected changed file ${requiredFile}`);
}
const l44ApiRows = [
  'GET | /api/leaders/me/withdrawable-commissions | leader self',
  'GET | /api/leaders/me/withdrawals | leader self',
  'GET | /api/leaders/me/withdrawals/:id | leader self',
  'POST | /api/leaders/me/withdrawals | leader self',
  'GET | /api/admin/withdrawals | withdrawal.view + data scope',
  'GET | /api/admin/withdrawals/:id | withdrawal.view + data scope',
  'POST | /api/admin/withdrawals/:id/approve | withdrawal.manage + data scope',
  'POST | /api/admin/withdrawals/:id/reject | withdrawal.manage + data scope',
  'POST | /api/admin/withdrawals/:id/mark-paid | withdrawal.manage + data scope'
];
for (const row of l44ApiRows) assert(l44Report.includes(row), `L44 report API row missing: ${row}`);
assert(!l44Report.includes('/api/admin/finance/refund-ledger'), 'L44 report must not include L28 refund-ledger API');
assert(!/\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|[^\n]*\|\s*public\s*\|/.test(l44Report), 'L44 API table must not show public permission');
assert(!/\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|[^\n]*\|\s*admin session\s*\|/.test(l44Report), 'L44 API table must not show admin session permission');
for (const requiredDb of ['Withdrawal', 'client_request_id', 'reviewed_by_admin_id', 'processed_by_admin_id', 'manual_reference', 'WithdrawalCommission', 'withdrawal_id', 'commission_id', 'amount_cents', 'unique(withdrawal_id, commission_id)', '20260714000100_l44_manual_withdrawal_review', '20260714000200_l44_withdrawal_commission_links']) {
  assert(l44Report.includes(requiredDb), `L44 report database section missing ${requiredDb}`);
}
for (const requiredVerify of ['L44 verifier', 'L24-L44 chain regression', 'Docker API E2E', 'Admin typecheck config', 'Admin full typecheck', 'raw compliance scan', 'Stage workflow']) {
  assert(l44Report.includes(requiredVerify) && l44Report.includes(`${requiredVerify} | passed`), `L44 report verification row must pass: ${requiredVerify}`);
}
for (const requiredQuality of ['高风险：暂无自动发现', '中风险：暂无自动发现']) {
  assert(l44Report.includes(requiredQuality), `L44 report quality summary missing: ${requiredQuality}`);
}
const unfinishedSection = l44Report.split('## 10. 未完成项')[1]?.split('## 11. Codex 给人工 reviewer 的说明')[0] ?? '';
assert(unfinishedSection.trim() === '暂无自动发现', `L44 report unfinished section must be empty; actual=${unfinishedSection.trim()}`);


const l45BaseCommit = '3ae666ec0e26383a5b117b64dce30b86a2dee389';
const l45Head = gitOutput(['rev-parse', 'HEAD']);
execFileSync('git', ['merge-base', '--is-ancestor', l45BaseCommit, l45Head], { stdio: 'pipe' });
const l45MergeBase = gitOutput(['merge-base', l45BaseCommit, l45Head]);
assert(l45MergeBase === l45BaseCommit, ['L45 report source must actually descend from business base', `base=${l45BaseCommit}`, `head=${l45Head}`, `merge_base=${l45MergeBase}`].join(' '));
execFileSync(process.execPath, ['scripts/generate-stage-report.ts', '--stage=L45'], { stdio: 'pipe' });
const l45Report = read('reports/stage-L45-report.md');
const l45ExpectedFiles = gitDiffFiles(l45BaseCommit, 'HEAD');
const l45ReportFiles = extractMarkdownFilePaths(l45Report);
assertSetEqual(l45ExpectedFiles, l45ReportFiles, 'L45 report changed files');
assert(l45Report.includes('业务稳定分支：stable/l44-business-base'), 'L45 report must include stable/l44-business-base');
assert(l45Report.includes(`业务稳定 commit：${l45BaseCommit}`), 'L45 report must include base commit');
assert(l45Report.includes(`报告生成 commit：${gitOutput(['rev-parse', 'HEAD'])}`), 'L45 report source commit must equal HEAD');
assert(l45Report.includes('Codex 自评结论：passed'), 'L45 report conclusion must be passed');
assert(!l45Report.includes('Codex 自评结论：partial'), 'L45 report must not be partial');
for (const row of ['GET | /api/admin/tax-records | finance.view + data scope', 'GET | /api/admin/tax-records/:id | finance.view + data scope', 'GET | /api/admin/tax-records/export.csv | finance.export + data scope', 'POST | /api/admin/withdrawals/:id/tax-review | withdrawal.manage + data scope', 'POST | /api/admin/withdrawals/:id/mark-paid | withdrawal.manage + data scope']) {
  assert(l45Report.includes(row), `L45 report API row missing: ${row}`);
}
for (const requiredDb of ['无新增表', '无新增字段', '复用 Withdrawal', '复用 WithdrawalCommission', '复用 TaxRecord', '复用 AdminAuditLog', '复用 BusinessEventLog']) {
  assert(l45Report.includes(requiredDb), `L45 report database section missing ${requiredDb}`);
}
for (const requiredVerify of ['L45 verifier', 'L24-L45 chain regression', 'Docker API E2E', 'Admin typecheck config', 'Admin full typecheck', 'raw compliance scan', 'Stage workflow']) {
  assert(l45Report.includes(requiredVerify) && l45Report.includes(`${requiredVerify} | passed`), `L45 report verification row must pass: ${requiredVerify}`);
}
for (const requiredQuality of ['高风险：暂无自动发现', 'L45 中风险：buildTaxRecordWhere 当前会读取可见 Withdrawal ID']) {
  assert(l45Report.includes(requiredQuality), `L45 report quality summary missing: ${requiredQuality}`);
}
const l45RiskSection = l45Report.split('## 9. 风险')[1]?.split('## 10. 未完成项')[0] ?? '';
assert(l45RiskSection.includes('L45 中风险：buildTaxRecordWhere 当前会读取可见 Withdrawal ID'), 'L45 known medium risk must be in risk section');
const l45UnfinishedSection = l45Report.split('## 10. 未完成项')[1]?.split('## 11. Codex 给人工 reviewer 的说明')[0] ?? '';
assert(l45UnfinishedSection.trim() === '暂无自动发现', `L45 report unfinished section must be empty; actual=${l45UnfinishedSection.trim()}`);

const stageWorkflowSource = read('scripts/stage-workflow.ts');
const mainStart = stageWorkflowSource.indexOf('function main(): void {');
assert(mainStart >= 0, 'stage workflow main function must exist');
const mainSource = stageWorkflowSource.slice(mainStart);
const reportStageIndex = mainSource.indexOf('runReportStage(args.stage!)');
const reportVerifierIndex = mainSource.indexOf('runReportVerifier();');
const reportPublishIndex = mainSource.indexOf('runReportPublish(args)');
assert(reportStageIndex >= 0, 'stage workflow must run report:stage in publish flow');
assert(reportVerifierIndex > reportStageIndex, 'stage workflow must run report verifier after report:stage');
assert(reportPublishIndex > reportVerifierIndex, 'stage workflow must run report verifier before report publish');
assert(stageWorkflowSource.includes("args: ['exec', 'tsx', 'scripts/verify-report-publish-local.ts']"), 'stage workflow must invoke report verifier through pnpm exec tsx');
assert(stageWorkflowSource.includes('Report publish verification passed.'), 'stage workflow must require report verifier success marker');

console.log('Report publish verification passed.');
