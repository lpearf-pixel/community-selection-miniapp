import { assertStageRegistered } from './stage-verifier-registration.ts';
import { readFileSync } from 'node:fs';

assertStageRegistered('L43', 'scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts');
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string) { return readFileSync(path, 'utf8'); }

const schema = read('prisma/schema.prisma');
const service = read('apps/api/src/services/commission-service.ts');
const commissions = read('apps/api/src/routes/commissions.ts');
const rewards = read('apps/api/src/routes/rewards.ts');
const adminPage = read('apps/admin/src/pages/rewards/RewardLedgerPage.tsx');
const migration = read('prisma/migrations/202607130001_l43_reward_ledger_t7_refund_deduct/migration.sql');
const idempotencyMigration = read('prisma/migrations/202607130002_l43_reward_ledger_t3_refund_deduct/migration.sql');
const docker = read('scripts/verify-docker-api-e2e-local.ts');
const dockerCompose = read('docker-compose.yml');
const reportGenerator = read('scripts/generate-stage-report.ts');
const stageWorkflow = read('scripts/stage-workflow.ts');

function functionSlice(source: string, functionName: string) {
  const start = source.search(new RegExp(`(?:function|async function|export function|export async function)\\s+${functionName}\\b`));
  if (start < 0) return '';
  const next = source.slice(start + 1).search(/\n(?:function|async function|export function|export async function)\s+\w+\b/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}


const apiCommandMatch = dockerCompose.match(/api:[\s\S]*?command: ([^\n]+)/);
assert(apiCommandMatch, 'docker-compose api command must exist');
const apiCommand = apiCommandMatch[1];
assert(apiCommand.includes('pnpm exec prisma migrate deploy --schema prisma/schema.prisma'), 'API Docker startup must use prisma migrate deploy');
assert(!apiCommand.includes('pnpm db:migrate'), 'API Docker startup must not use pnpm db:migrate');
assert(!apiCommand.includes('prisma migrate dev'), 'API Docker startup must not use prisma migrate dev');
assert(dockerCompose.includes('postgres-data:/var/lib/postgresql/data') && dockerCompose.includes('postgres-data:'), 'Postgres data volume must remain configured');
assert(dockerCompose.includes('curl -fsS http://localhost:13080/api/health'), 'API healthcheck must remain on port 13080');
for (const permissionText of ['leader self','reward.view','reward.manage', 'super_admin global']) { assert(reportGenerator.includes(permissionText), `L43 report manifest missing ${permissionText}`); }
for (const forbiddenReportPermission of ['public', 'admin session', 'unknown']) { assert(!reportGenerator.includes(`permission: '${forbiddenReportPermission}'`) && !reportGenerator.includes(`permissions: ['${forbiddenReportPermission}']`), `L43 report must not emit ${forbiddenReportPermission} permission`); }
for (const reportMarker of ['hasPositiveL43Marker', 'release_due_fixture_status=available', 'release_due_fixture_ledger_count=1', 'release_due_fixture_balance_verified=true', 'settle_fixture_status=available', 'settle_fixture_ledger_count=1', 'settle_fixture_balance_verified=true', 'backfill_fixture_ledger_count=1', 'backfill_fixture_balance_verified=true', 'via stage-workflow', 'not detected']) {
  assert(reportGenerator.includes(reportMarker), `L43 report generator missing runtime evidence marker ${reportMarker}`);
}
assert(reportGenerator.includes('全局 API 成功响应中出现 0 结果') && reportGenerator.includes('报告声称全局 API 已验收但缺少完整非零运行时证据'), 'L43 report must flag missing or zero global API runtime evidence as high risk');
for (const reportQualitySnippet of [
  'expectedCoreFiles',
  'getStageBaseRef',
  "'diff', '--name-only'",
  'assertChangedFileCoverage',
  'Stage report changed-file coverage mismatch',
  'Diff base：',
  'Changed files count：',
  'commandPassedInSectionOnly',
  "raw compliance scan passed.",
  '202607130001_l43_reward_ledger_t7_refund_deduct',
  '202607130002_l43_reward_ledger_t3_refund_deduct',
  'review_status, review_note, reviewed_by_admin_id, reviewed_at, last_adjusted_at',
  'idempotency_key, event_type, affects_available_balance, effective_at, refund_id',
  'original_key:legacy:{ledger.id}'
]) {
  assert(reportGenerator.includes(reportQualitySnippet), `L43 report generator missing quality snippet: ${reportQualitySnippet}`);
}
assert(!reportGenerator.includes('l43Manifest.files'), 'L43 report generator must not use l43Manifest.files as changed-file source');

const mainEnd = docker.indexOf('main().catch');
assert(mainEnd > 0, 'Docker E2E must call main().catch');
const afterMain = docker.slice(mainEnd);
for (const marker of ['status_after_t3=available', 'scoped_finance_release_due_403', 'super_admin_global_reward_ops_success']) {
  assert(!afterMain.includes(marker), `${marker} must not be printed outside runtime assertions`);
}
for (const requiredRuntimeSnippet of [
  "request('POST', path",
  "'/api/admin/rewards/release-due'",
  "'/api/admin/commissions/settle'",
  "request<L43GlobalOperationResult>('POST', '/api/admin/rewards/backfill'",
  'prisma.commission.findUniqueOrThrow',
  'prisma.rewardLedger.count',
  'prisma.rewardLedger.findMany',
  'assert(releaseResult.matched_count >= 1',
  'assert((releaseResult.released_count ?? 0) >= 1',
  'assert(releaseResult.ledger_created_count >= 1',
  'assert(settleCheck.first.matched_count >= 1',
  'assert((settleCheck.first.released_count ?? 0) >= 1',
  'assert(settleCheck.first.ledger_created_count >= 1',
  'assert(backfillResult.matched_count >= 1',
  'assert(backfillResult.ledger_created_count >= 1',
  'repeat must not duplicate fixture ledger',
  'repeat must not increase fixture balance',
  'globalOperationRunId',
  'createL43PendingCommissionFixture',
  'createL43AvailableWithoutLedgerFixture',
  'cleanupL43GlobalOperationFixtures',
  'available_at must equal completed_at plus 72 hours',
  'delivery-fee-only refund must not change reward',
  'repeated partial refund sync must not duplicate deduct ledger',
  'must not mutate commission, ledger, admin audit, or success events'
]) {
  assert(docker.includes(requiredRuntimeSnippet), `Docker E2E missing runtime assertion snippet: ${requiredRuntimeSnippet}`);
}


const calculationSurface = [
  functionSlice(service, 'productOriginal'),
  functionSlice(service, 'productRemaining'),
  functionSlice(service, 'calculateCommissionAmount'),
  functionSlice(service, 'ensureEstimatedCommission'),
  functionSlice(service, 'syncCommissionAfterRefund')
].join('\n');

[
  'review_status','last_adjusted_at','idempotency_key','event_type','affects_available_balance','amount_before_cents','amount_after_cents','@@unique([order_id, leader_user_id])'
].forEach((needle) => assert(schema.includes(needle), `schema missing ${needle}`));
assert(migration.includes('Rollback') && migration.includes('DEFAULT'), 'migration must include defaults and rollback notes');
assert(idempotencyMigration.includes('ROW_NUMBER() OVER') && idempotencyMigration.includes("ledger.idempotency_key || ':legacy:' || ledger.id"), 'L43 idempotency migration must deterministically rewrite duplicate historical keys');
assert(idempotencyMigration.includes('DROP INDEX IF EXISTS "RewardLedger_idempotency_key_key"') && idempotencyMigration.includes('CREATE UNIQUE INDEX "RewardLedger_idempotency_key_key" ON "RewardLedger"("idempotency_key")'), 'L43 idempotency migration must create Prisma-compatible nullable unique index');
[
  'product_refund_amount_cents','calculateCommissionAmount','getAvailableRewardBalance','releaseDueCommissions','commission-available:${item.id}','commission_refund_deduct','commission_review_required','commission_refund_adjustment_pending','backfillAvailableRewardLedgers'
].forEach((needle) => assert(service.includes(needle), `service missing ${needle}`));
assert(calculationSurface.includes('product_amount_cents'), 'reward calculation must use product_amount_cents');
assert(calculationSurface.includes('product_refund_amount_cents'), 'reward refund calculation must use product_refund_amount_cents');
assert(!/pay_amount_cents\s*[-+*/]/.test(calculationSurface), 'reward calculation must not use pay_amount_cents');
assert(!/delivery_fee_cents\s*[-+*/]/.test(calculationSurface), 'delivery fee must not participate in reward calculation');
assert(!/refund_amount_cents\s*[-+*/]/.test(calculationSurface), 'total refund amount must not drive reward calculation');

type RewardCase = { product_amount_cents: number; delivery_fee_cents: number; pay_amount_cents: number; product_refund_amount_cents: number; delivery_refund_amount_cents: number; refund_amount_cents: number; commission_value: number; };
function rewardAmount(input: RewardCase) {
  const originalProductAmountCents = input.product_amount_cents;
  const remainingProductAmountCents = Math.max(0, originalProductAmountCents - input.product_refund_amount_cents);
  return Math.floor((remainingProductAmountCents * input.commission_value) / 100);
}
const base = { product_amount_cents: 10000, delivery_fee_cents: 500, pay_amount_cents: 10500, product_refund_amount_cents: 0, delivery_refund_amount_cents: 0, refund_amount_cents: 0, commission_value: 10 };
assert(rewardAmount(base) === 1000, 'delivery fee must not be included in initial reward');
assert(rewardAmount({ ...base, delivery_refund_amount_cents: 500, refund_amount_cents: 500 }) === 1000, 'delivery-fee-only refund must not change reward');
assert(rewardAmount({ ...base, product_refund_amount_cents: 3000, delivery_refund_amount_cents: 500, refund_amount_cents: 3500 }) === 700, 'product refund must recalculate reward using product refund amount only');
assert(1000 - rewardAmount({ ...base, product_refund_amount_cents: 3000, delivery_refund_amount_cents: 500, refund_amount_cents: 3500 }) === 300, 'product refund deduct amount must be 300');
assert(rewardAmount({ ...base, product_refund_amount_cents: 10000, refund_amount_cents: 10500 }) === 0, 'full product refund must zero reward');

assert(
  commissions.includes('/api/leaders/me/commissions') &&
    commissions.includes("withCurrentLeader(") &&
    !commissions.includes('resolveLeaderId') &&
    !commissions.includes('query.openid'),
  'leader API ownership must use the shared header-only current-leader boundary',
);
assert(commissions.includes("requireAdminPermission('reward.view')") && commissions.includes("requireAdminPermission('reward.manage')") && commissions.includes('ADMIN_SCOPE_FORBIDDEN'), 'admin reward permission/scope missing');
assert(commissions.includes('function requireGlobalRewardOperationAccess') && commissions.includes('if (!context.is_super_admin)') && !commissions.includes("context.role === 'finance' && hasAllCommunityScope(context)"), 'global reward operation helper must be super_admin-only');
for (const route of ["/api/admin/rewards/release-due", "/api/admin/commissions/settle", "/api/admin/rewards/backfill"]) {
  const routeIndex = commissions.indexOf(route);
  assert(routeIndex >= 0, `${route} must exist`);
  assert(commissions.slice(routeIndex, routeIndex + 650).includes('requireGlobalRewardOperationAccess(request, reply)'), `${route} must call the unified global reward operation helper`);
}
for (const marker of ['scoped_finance_release_due_403','scoped_finance_settle_403','scoped_finance_backfill_403','store_manager_global_reward_ops_403','operator_global_reward_ops_403','inactive_admin_global_reward_ops_401','super_admin_global_reward_ops_success','global_reward_negative_no_commission_change','global_reward_negative_no_ledger_change','global_reward_negative_no_success_event']) {
  assert(docker.includes(marker), `Docker API E2E missing global reward auth marker ${marker}`);
}
assert(commissions.includes('/api/admin/rewards/release-due') && commissions.includes('/api/admin/rewards/:id/review'), 'admin rewards endpoints missing');
const hasLegacyConvertCreditIdempotencyKey = rewards.includes(
  'convert-credit:${body.client_request_id}',
);
const hasNormalizedConvertCreditIdempotencyKey =
  /const\s+clientRequestId\s*=\s*String\(\s*body\.client_request_id\s*\?\?\s*''\s*\)\.trim\(\);/.test(
    rewards,
  ) &&
  /idempotency_key:\s*`convert-credit:\$\{clientRequestId\}`/.test(rewards);
assert(
  rewards.includes('getAvailableRewardBalance') &&
    rewards.includes('affects_available_balance') &&
    (hasLegacyConvertCreditIdempotencyKey ||
      hasNormalizedConvertCreditIdempotencyKey),
  'convert credit ledger compatibility missing',
);
['开团服务奖励','待可用','已可用','退款扣减','待人工复核','完成后第 3 天可用'].forEach((needle) => assert(adminPage.includes(needle), `admin page missing ${needle}`));
assert(docker.includes('Reward ledger:') && docker.includes('initial_amount_cents=1000') && docker.includes('delivery_refund_adjusted_amount_cents=1000') && docker.includes('delivery_refund_deduct_ledger_count=0') && docker.includes('product_refund_adjusted_amount_cents=700') && docker.includes('refund_deduct_ledger_count=1'), 'Docker API E2E L43 reward markers missing');
for (const nonzeroMarker of ['available_balance_after_release_cents=','available_balance_after_delivery_refund_cents=','available_balance_after_partial_product_refund_cents=','available_balance_after_full_product_refund_cents=','release_due_matched_count=','release_due_released_count=','release_due_ledger_created_count=','release_due_repeat_ledger_created_count=','release_due_fixture_status=','release_due_fixture_ledger_count=','release_due_fixture_balance_verified=','settle_matched_count=','settle_released_count=','settle_ledger_created_count=','settle_repeat_ledger_created_count=','settle_fixture_status=','settle_fixture_ledger_count=','settle_fixture_balance_verified=','backfill_matched_count=','backfill_ledger_created_count=','backfill_repeat_ledger_created_count=','backfill_fixture_ledger_count=','backfill_fixture_balance_verified=']) {
  assert(docker.includes(nonzeroMarker), `Docker API E2E missing nonzero L43 marker ${nonzeroMarker}`);
}
assert(service.includes('rewardAvailabilityDelayDays = 3'), 'T+3 release rule must be 72 hours');
assert(!service.includes('settlementDelayDays = ' + '7'), 'legacy seven-day reward delay must not remain');
console.log('L43 reward ledger T3 refund deduct verification passed.');
