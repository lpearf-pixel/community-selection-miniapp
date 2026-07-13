import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string) { return readFileSync(path, 'utf8'); }
const schema = read('prisma/schema.prisma');
const service = read('apps/api/src/services/commission-service.ts');
const commissions = read('apps/api/src/routes/commissions.ts');
const rewards = read('apps/api/src/routes/rewards.ts');
const adminPage = read('apps/admin/src/pages/rewards/RewardLedgerPage.tsx');
const migration = read('prisma/migrations/202607130001_l43_reward_ledger_t7_refund_deduct/migration.sql');
const docker = read('scripts/verify-docker-api-e2e-local.ts');

[
  'review_status','last_adjusted_at','idempotency_key','event_type','affects_available_balance','amount_before_cents','amount_after_cents','@@unique([order_id, leader_user_id])'
].forEach((needle) => assert(schema.includes(needle), `schema missing ${needle}`));
assert(migration.includes('Rollback') && migration.includes('DEFAULT'), 'migration must include defaults and rollback notes');
[
  'product_refund_amount_cents','delivery_refund_amount_cents','calculateCommissionAmount','getAvailableRewardBalance','releaseDueCommissions','commission-available:${item.id}','commission_refund_deduct','commission_review_required','commission_refund_adjustment_pending','backfillAvailableRewardLedgers'
].forEach((needle) => assert(service.includes(needle), `service missing ${needle}`));
assert(!service.includes('- order.refund_amount_cents'), 'service must not use refund_amount_cents as reward basis');
assert(commissions.includes('/api/leaders/me/commissions') && commissions.includes('x-openid') && commissions.includes('禁止查看其他开团人的开团服务奖励'), 'leader API ownership missing');
assert(commissions.includes("requireAdminPermission('reward.view')") && commissions.includes("requireAdminPermission('reward.manage')") && commissions.includes('ADMIN_SCOPE_FORBIDDEN'), 'admin reward permission/scope missing');
assert(commissions.includes('/api/admin/rewards/release-due') && commissions.includes('/api/admin/rewards/:id/review'), 'admin rewards endpoints missing');
assert(rewards.includes('getAvailableRewardBalance') && rewards.includes('affects_available_balance') && rewards.includes('convert-credit:${body.client_request_id}'), 'convert credit ledger compatibility missing');
['开团服务奖励','待可用','已可用','退款扣减','待人工复核','完成后第 7 天可用'].forEach((needle) => assert(adminPage.includes(needle), `admin page missing ${needle}`));
assert(docker.includes('Reward ledger:') && docker.includes('status_after_t7=available'), 'Docker API E2E L43 markers missing');
console.log('L43 reward ledger T7 refund deduct verification passed.');
