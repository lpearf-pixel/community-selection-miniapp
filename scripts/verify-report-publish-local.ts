import { readFileSync, existsSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string) {
  return readFileSync(path, 'utf8');
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
for (const permissionText of ['leader self', 'reward.view', 'reward.manage', 'global scope']) {
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

console.log('Report publish verification passed.');
