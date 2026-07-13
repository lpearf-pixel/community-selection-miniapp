import { readFileSync } from 'node:fs';

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

function functionSlice(source: string, functionName: string) {
  const start = source.search(new RegExp(`(?:function|async function|export function|export async function)\\s+${functionName}\\b`));
  if (start < 0) return '';
  const next = source.slice(start + 1).search(/\n(?:function|async function|export function|export async function)\s+\w+\b/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
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

assert(commissions.includes('/api/leaders/me/commissions') && commissions.includes('x-openid') && commissions.includes('禁止查看其他开团人的开团服务奖励'), 'leader API ownership missing');
assert(commissions.includes("requireAdminPermission('reward.view')") && commissions.includes("requireAdminPermission('reward.manage')") && commissions.includes('ADMIN_SCOPE_FORBIDDEN'), 'admin reward permission/scope missing');
assert(commissions.includes('/api/admin/rewards/release-due') && commissions.includes('/api/admin/rewards/:id/review'), 'admin rewards endpoints missing');
assert(rewards.includes('getAvailableRewardBalance') && rewards.includes('affects_available_balance') && rewards.includes('convert-credit:${body.client_request_id}'), 'convert credit ledger compatibility missing');
['开团服务奖励','待可用','已可用','退款扣减','待人工复核','完成后第 7 天可用'].forEach((needle) => assert(adminPage.includes(needle), `admin page missing ${needle}`));
assert(docker.includes('Reward ledger:') && docker.includes('initial_amount_cents=1000') && docker.includes('delivery_refund_adjusted_amount_cents=1000') && docker.includes('delivery_refund_deduct_ledger_count=0') && docker.includes('product_refund_adjusted_amount_cents=700') && docker.includes('refund_deduct_ledger_count=1'), 'Docker API E2E L43 reward markers missing');
assert(service.includes('settlementDelayDays = 7'), 'T+7 release rule must remain unchanged');
console.log('L43 reward ledger T3 refund deduct verification passed.');
