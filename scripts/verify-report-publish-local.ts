import { parseStageArg } from './stage-args.ts';
import { getStageDefinition } from './stage-registry.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { L45_API_CONTRACT_LIST, l45ConcurrentRuntimeMarkers } from './l45-api-contract.ts';
const stage = parseStageArg(process.argv.slice(2));

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
const l45GeneratorRequired = ['isL45Stage', 'L45 manual tax review and internal CSV export', 'stable/l44-business-base', '3ae666ec0e26383a5b117b64dce30b86a2dee389', 'withdrawal.manage + data scope', '无新增表', '无新增字段', '复用 Withdrawal', '复用 WithdrawalCommission', '复用 TaxRecord', '复用 AdminAuditLog', '复用 BusinessEventLog', 'L24-L45 chain regression', 'L45_API_CONTRACT_LIST', 'runtime_markers_required', 'l45ApiVerified', 'l45ConcurrentRuntimeMarkers'];
for (const required of l45GeneratorRequired) assert(generateSource.includes(required), `L45 report generator should include ${required}`);
assert(/api\.runtime_markers_required\.every\s*\(/.test(generateSource), 'L45 report must verify every per-API required marker');
assert(/L45_API_CONTRACT_LIST\.flatMap\(\s*\(?api\)?\s*=>\s*api\.runtime_markers_required\s*\)/.test(generateSource), 'L45 Docker report verification must consume all contract markers');
assert(!generateSource.includes("permissions: ['public']"), 'L44 report permissions must not be public');
const l45ContractSource = read('scripts/l45-api-contract.ts');
for (const required of ['tax_record_list','tax_record_detail','tax_record_export','tax_review','mark_paid','fulfilled_count','applied_count','idempotent_count','runtime_markers_required']) assert(l45ContractSource.includes(required), `L45 machine contract missing ${required}`);
const requiredRuntimeMarkers = L45_API_CONTRACT_LIST.flatMap((api) => api.runtime_markers_required);
assert(requiredRuntimeMarkers.length > 0, 'L45 contract must define required runtime markers');
assert(new Set(requiredRuntimeMarkers).size === requiredRuntimeMarkers.length, 'L45 required runtime markers must be unique');
for (const marker of requiredRuntimeMarkers) assert(l45ContractSource.includes(marker), `L45 machine contract source missing ${marker}`);
assert(generateSource.includes('l45ConcurrentRuntimeMarkers'), 'L45 report generator must use the concurrent marker wrapper helper');
assert(l45ContractSource.includes('function l45TaxReviewConcurrentScenario()') && l45ContractSource.includes('function l45ConcurrentRuntimeMarkers()') && l45ContractSource.includes('l45TaxReviewConcurrentScenario();'), 'L45 contract wrapper must call the fail-closed concurrent scenario helper');
for (const requiredFailClosed of ['scenarios.length !== 1', 'must contain exactly one concurrent scenario', 'positive integer', 'fulfilled_count === applied_count + idempotent_count']) assert(l45ContractSource.includes(requiredFailClosed), `L45 concurrent helper must fail closed for ${requiredFailClosed}`);
assert(l45ConcurrentRuntimeMarkers().every((marker) => generateSource.includes('l45ConcurrentRuntimeMarkers') || l45ContractSource.includes(marker.split('=')[0])), 'L45 report verifier must share concurrent marker helper semantics');
const dockerE2eSource = read('scripts/verify-docker-api-e2e-local.ts');
for (const marker of requiredRuntimeMarkers) assert(dockerE2eSource.includes(marker), `L45 Docker E2E missing required runtime marker ${marker}`);
assert(!dockerE2eSource.includes('const l44RuntimeEvidence'), 'L44 Docker E2E must not use hardcoded evidence object');
for (const required of ['=== L44 leader identity scenario ===','l44_creation_scenario_passed','Promise.allSettled','/api/leaders/me/withdrawals','/api/admin/withdrawals/','prisma.withdrawal','prisma.withdrawalCommission','prisma.rewardLedger','prisma.businessEventLog','getAvailableRewardBalance']) {
  assert(dockerE2eSource.includes(required), `L44 Docker E2E should include real runtime evidence: ${required}`);
}
for (const required of ['runL45TaxReviewScenario', 'POST /api/admin/withdrawals/:id/tax-review', 'Promise.allSettled', 'prisma.withdrawal', 'prisma.taxRecord', 'prisma.adminAuditLog', 'prisma.businessEventLog', 'financeNoScopeHeaders', 'fixtureB', 'negative taxable', '=HYPERLINK', '+SUM(1,1)', '@cmd', '-1+2', 'none nonzero tax']) {
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

function changedFilesForStage(stageId: string) {
  const definition = getStageDefinition(stageId);
  assert(definition, `registered report stage is required: ${stageId}`);
  const contract = definition.reportContract;
  assert(contract?.sourceMode === 'git_diff', `${definition.id} report contract must use git_diff`);
  return { base: contract.businessBaseCommit, files: gitDiffFiles(contract.businessBaseCommit, 'HEAD') };
}
function validateCommonReport(stageId: string) {
  const definition = getStageDefinition(stageId);
  assert(definition, `stage registry must define ${stageId}`);
  execFileSync(process.execPath, ['scripts/generate-stage-report.ts', `--stage=${definition.id}`], { stdio: 'pipe' });
  const report = read(`reports/stage-${definition.id}-report.md`);
  const { files } = changedFilesForStage(definition.id);
  assertSetEqual(files, extractMarkdownFilePaths(report), `${definition.id} report changed files`);
  assert(report.includes(`报告生成 commit：${gitOutput(['rev-parse', 'HEAD'])}`), `${definition.id} report source commit must equal HEAD`);
  return report;
}

function validateL43Report(report: string) {
  const base = '20d5023f0e493bad7485e4fe8cbc5ccba014e118';
  assertSetEqual(gitDiffFiles(base, 'HEAD'), extractMarkdownFilePaths(report), 'L43 report changed files');
  assert(report.includes(`业务稳定 commit：${base}`) && report.includes(`报告生成 commit：${gitOutput(['rev-parse', 'HEAD'])}`), 'L43 report base/source commit');
  for (const required of ['prisma/migrations/202607130001_l43_reward_ledger_t7_refund_deduct/migration.sql','prisma/migrations/202607130002_l43_reward_ledger_t3_refund_deduct/migration.sql','review_status','last_adjusted_at','idempotency_key','affects_available_balance','original_key:legacy:{ledger.id}']) assert(report.includes(required), `L43 report should include ${required}`);
  assert(!report.includes('Commission | L43 manifest') && !report.includes('RewardLedger | L43 manifest'), 'L43 report must not contain manifest placeholders');
  assert(report.includes('Codex 自评结论：passed') && !report.includes('Codex 自评结论：partial'), 'L43 report conclusion');
}
function validateL44Report(report: string) {
  const base = getStageDefinition('L44')!.reportContract!.businessBaseCommit; assertSetEqual(gitDiffFiles(base, 'HEAD'), extractMarkdownFilePaths(report), 'L44 report changed files');
  assert(report.includes('Codex 自评结论：passed') && !report.includes('Codex 自评结论：partial'), 'L44 report conclusion');
  for (const row of ['GET | /api/leaders/me/withdrawable-commissions | leader self','GET | /api/leaders/me/withdrawals | leader self','GET | /api/leaders/me/withdrawals/:id | leader self','POST | /api/leaders/me/withdrawals | leader self','GET | /api/admin/withdrawals | withdrawal.view + data scope','GET | /api/admin/withdrawals/:id | withdrawal.view + data scope','POST | /api/admin/withdrawals/:id/approve | withdrawal.manage + data scope','POST | /api/admin/withdrawals/:id/reject | withdrawal.manage + data scope','POST | /api/admin/withdrawals/:id/mark-paid | withdrawal.manage + data scope']) assert(report.includes(row), `L44 report API row missing: ${row}`);
  assert(!/\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|[^\n]*\|\s*(public|admin session)\s*\|/.test(report), 'L44 API permission must be precise');
  for (const item of ['Withdrawal','WithdrawalCommission','client_request_id','reviewed_by_admin_id','processed_by_admin_id','manual_reference','withdrawal_id','commission_id','amount_cents','unique(withdrawal_id, commission_id)','20260714000100_l44_manual_withdrawal_review','20260714000200_l44_withdrawal_commission_links']) assert(report.includes(item), `L44 database section missing ${item}`);
  for (const item of ['L44 verifier','L24-L44 chain regression','Docker API E2E','Admin typecheck config','Admin full typecheck','raw compliance scan','Stage workflow']) assert(report.includes(`${item} | passed`), `L44 report verification row must pass: ${item}`);
  assert(report.includes('高风险：暂无自动发现') && report.includes('中风险：暂无自动发现'), 'L44 risks'); assert((report.split('## 10. 未完成项')[1]?.split('## 11. Codex 给人工 reviewer 的说明')[0] ?? '').trim() === '暂无自动发现', 'L44 unfinished');
}
function validateL45Report(report: string) {
  const base=getStageDefinition('L45')!.reportContract!.businessBaseCommit; assertSetEqual(gitDiffFiles(base,'HEAD'),extractMarkdownFilePaths(report),'L45 report changed files'); assert(report.includes('业务稳定分支：stable/l44-business-base') && report.includes(`业务稳定 commit：${base}`) && report.includes('Codex 自评结论：passed') && !report.includes('Codex 自评结论：partial'),'L45 report metadata');
  for (const row of ['GET | /api/admin/tax-records | finance.view + data scope','GET | /api/admin/tax-records/:id | finance.view + data scope','GET | /api/admin/tax-records/export.csv | finance.export + data scope','POST | /api/admin/withdrawals/:id/tax-review | withdrawal.manage + data scope','POST | /api/admin/withdrawals/:id/mark-paid | withdrawal.manage + data scope']) assert(report.includes(row),`L45 report API row missing: ${row}`);
  for (const item of ['无新增表','无新增字段','复用 Withdrawal','复用 WithdrawalCommission','复用 TaxRecord','复用 AdminAuditLog','复用 BusinessEventLog']) assert(report.includes(item),`L45 report database section missing ${item}`); for (const item of ['L45 verifier','L24-L45 chain regression','Docker API E2E','Admin typecheck config','Admin full typecheck','raw compliance scan','Stage workflow']) assert(report.includes(`${item} | passed`),`L45 report verification row must pass: ${item}`); assert((report.split('## 9. 风险')[1]?.split('## 10. 未完成项')[0]??'').includes('L45 中风险：buildTaxRecordWhere 当前会读取可见 Withdrawal ID'),'L45 known medium risk'); assert((report.split('## 10. 未完成项')[1]?.split('## 11. Codex 给人工 reviewer 的说明')[0]??'').trim()==='暂无自动发现','L45 unfinished');
}

function validateL46Report(report: string) {
  assert(report.includes('阶段：L46'), 'L46 report must identify its own stage');
  const definition = getStageDefinition('L46');
  assert(definition, 'L46 must be registered');
  assert(report.includes(`- 注册阶段标题：${definition.title}`), 'L46 report must use the registered stage title');
  assert(report.includes(`- 本阶段目标：${definition.title}`), 'L46 report goal must use the registered stage title');
}

const scannerDefinitionFixture = `function isVerifierTodoTestString() { return /${'TO' + 'DO'}|${'FIX' + 'ME'}|${'T' + 'BD'}|${'NOT_' + 'IMPLEMENTED'}/.test(''); }`;
const realTodoFixture = `export function calculateReward() { // ${'TO' + 'DO'}: implement reward calculation }`;
const verifierFixture = `assert(!source.includes('${'TO' + 'DO'}'), 'runtime source must not contain ${'TO' + 'DO'}');`;
assert(fixtureTodoItems('scripts/generate-stage-report.ts', scannerDefinitionFixture).length === 0, 'TODO scanner implementation fixture');
assert(fixtureTodoItems('apps/api/src/services/reward-example.ts', realTodoFixture).length === 1, 'real business TODO fixture');
assert(fixtureTodoItems('scripts/verify-example-local.ts', verifierFixture).length === 0, 'verifier TODO assertion fixture');
const report = validateCommonReport(stage);
if (stage === 'L43') validateL43Report(report);
if (stage === 'L44') validateL44Report(report);
if (stage === 'L45') validateL45Report(report);
if (stage === 'L46') validateL46Report(report);

const stageWorkflowSource = read('scripts/stage-workflow.ts');
const mainSource = stageWorkflowSource.slice(stageWorkflowSource.indexOf('function main(): void {'));
assert(mainSource.indexOf('runReportStage(args.stage!)') >= 0, 'stage workflow must run report:stage in publish flow');
assert(mainSource.indexOf('runReportVerifier(args.stage!)') > mainSource.indexOf('runReportStage(args.stage!)'), 'stage workflow must run report verifier after report:stage');
assert(mainSource.indexOf('runReportPublish(args)') > mainSource.indexOf('runReportVerifier(args.stage!)'), 'stage workflow must run report verifier before report publish');
assert(stageWorkflowSource.includes("args: ['exec', 'tsx', 'scripts/verify-report-publish-local.ts', `--stage=${stage}`]"), 'stage workflow must forward --stage=${stage} to report verifier');
assert(stageWorkflowSource.includes('Report publish verification passed.'), 'stage workflow must require report verifier success marker');

console.log('Report publish verification passed.');
