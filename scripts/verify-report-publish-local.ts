import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

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
assert(generateSource.includes('RewardLedger') && generateSource.includes('idempotency_key') && generateSource.includes('affects_available_balance'), 'L43 report must describe RewardLedger concrete fields');
assert(!generateSource.includes("change: 'L43 manifest'"), 'L43 DB rows must not use L43 manifest placeholders');
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

console.log('Report publish verification passed.');
