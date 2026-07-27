import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

assertStageRegistered('L39', 'scripts/verify-l39-delivery-refund-finance-baseline-local.ts');
function read(file: string) { return readFileSync(file, 'utf8'); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function includesAll(file: string, needles: string[]) { const text = read(file); for (const needle of needles) assert(text.includes(needle), `${file} missing ${needle}`); }
function excludesAllText(label: string, text: string, needles: string[]) { for (const needle of needles) assert(!text.includes(needle), `${label} contains forbidden marker: ${needle}`); }

const files = [
  'prisma/schema.prisma',
  'prisma/migrations/202607100002_l39_delivery_refund_finance_baseline/migration.sql',
  'apps/api/src/services/refund-service.ts',
  'apps/api/src/modules/after-sale/after-sale-service.ts',
  'apps/api/src/modules/finance/finance-report-service.ts',
  'apps/api/src/modules/user-orders/user-order-service.ts',
  'apps/api/src/routes/refunds.ts',
  'apps/api/src/routes/after-sales.ts',
  'apps/admin/src/api/financeRefundLedger.ts',
  'apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx',
  'apps/miniapp/pages/orders/detail/index.js',
  'apps/miniapp/pages/orders/detail/index.wxml',
  'apps/miniapp/pages/after-sales/detail/index.js',
  'apps/miniapp/pages/after-sales/detail/index.wxml',
  'scripts/verify-l39-delivery-refund-finance-baseline-local.ts',
  'scripts/verify-docker-api-e2e-local.ts',
  'scripts/verify-all-local.sh',
  'scripts/stage-workflow.ts',
  'scripts/generate-stage-report.ts',
  'docs/reviews/l39-delivery-refund-finance-baseline.md'
];
for (const file of files) assert(existsSync(file), `Missing file: ${file}`);
assert(readdirSync('prisma/migrations', { withFileTypes: true }).some((entry) => entry.isDirectory() && entry.name.endsWith('_l39_delivery_refund_finance_baseline')), 'Missing L39 migration');

includesAll('prisma/schema.prisma', [
  'product_refund_amount_cents',
  'delivery_refund_amount_cents',
  'requested_product_refund_cents',
  'requested_delivery_refund_cents',
  'approved_product_refund_cents',
  'approved_delivery_refund_cents',
  'product_amount_cents',
  'delivery_fee_cents',
  'pay_amount_cents',
  'refund_amount_cents'
]);
includesAll('prisma/migrations/202607100002_l39_delivery_refund_finance_baseline/migration.sql', [
  '"Order" ADD COLUMN "product_refund_amount_cents" INTEGER NOT NULL DEFAULT 0',
  '"Order" ADD COLUMN "delivery_refund_amount_cents" INTEGER NOT NULL DEFAULT 0',
  '"Refund" ADD COLUMN "product_refund_amount_cents" INTEGER NOT NULL DEFAULT 0',
  '"Refund" ADD COLUMN "delivery_refund_amount_cents" INTEGER NOT NULL DEFAULT 0',
  '"AfterSaleCase" ADD COLUMN "requested_product_refund_cents" INTEGER',
  '"AfterSaleCase" ADD COLUMN "requested_delivery_refund_cents" INTEGER',
  '"AfterSaleCase" ADD COLUMN "approved_product_refund_cents" INTEGER',
  '"AfterSaleCase" ADD COLUMN "approved_delivery_refund_cents" INTEGER'
]);
includesAll('apps/api/src/services/refund-service.ts', [
  'allocateRefundSplit',
  'productRefund + deliveryRefund !== input.refund_amount_cents',
  '商品退款金额超过商品可退金额',
  '配送费退款金额超过配送费可退金额',
  'getRefundableAmount',
  'remainingRefundableAmount',
  'product_refund_amount_cents',
  'delivery_refund_amount_cents'
]);
includesAll('apps/api/src/modules/after-sale/after-sale-service.ts', [
  'requested_product_refund_cents',
  'requested_delivery_refund_cents',
  'approved_product_refund_cents',
  'approved_delivery_refund_cents',
  '商品退款金额与配送费退款金额之和必须等于总退款金额'
]);
includesAll('apps/api/src/modules/finance/finance-report-service.ts', [
  'total_product_refund_amount_cents',
  'total_delivery_refund_amount_cents',
  'remaining_refundable_amount_cents',
  'product_refund_amount_cents',
  'delivery_refund_amount_cents',
  '^[=+\\-@\\t\\r]'
]);
includesAll('apps/api/src/modules/user-orders/user-order-service.ts', ['refund_split', 'remaining_refundable_amount_cents', 'requested_product_refund_cents']);
includesAll('apps/admin/src/api/financeRefundLedger.ts', ['product_refund_amount_cents', 'delivery_refund_amount_cents', 'remaining_refundable_amount_cents']);
includesAll('apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx', ['商品退款合计', '配送费退款合计', '剩余可退合计']);
includesAll('apps/miniapp/pages/orders/detail/index.wxml', ['已退商品金额', '已退配送费', '剩余可退']);
includesAll('apps/miniapp/pages/after-sales/detail/index.wxml', ['商品退款', '配送费退款']);

const rewardSources = [
  existsSync('apps/api/src/services/commission-service.ts') ? read('apps/api/src/services/commission-service.ts') : '',
  existsSync('apps/api/src/modules/rewards/reward-ledger-service.ts') ? read('apps/api/src/modules/rewards/reward-ledger-service.ts') : ''
].join('\n');

function functionSlice(source: string, functionName: string) {
  const start = source.search(new RegExp(`(?:function|async function|export function|export async function)\\s+${functionName}\\b`));
  if (start < 0) return '';
  const next = source.slice(start + 1).search(/\n(?:function|async function|export function|export async function)\s+\w+\b/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

const commissionCalculationSurface = [
  functionSlice(rewardSources, 'productOriginal'),
  functionSlice(rewardSources, 'productRemaining'),
  functionSlice(rewardSources, 'calculateCommissionAmount'),
  functionSlice(rewardSources, 'calculateRefundAdjustedAmount'),
  functionSlice(rewardSources, 'ensureEstimatedCommission'),
  functionSlice(rewardSources, 'syncCommissionAfterRefund')
].filter(Boolean).join('\n');

assert(rewardSources.includes('product_amount_cents'), 'Commission calculation must use product amount');
assert(rewardSources.includes('product_refund_amount_cents'), 'Commission refund adjustment must use product refund amount');
assert(commissionCalculationSurface.includes('product_amount_cents'), 'Commission calculation surface must include product amount');
assert(commissionCalculationSurface.includes('product_refund_amount_cents'), 'Commission calculation surface must include product refund amount');
assert(!/pay_amount_cents\s*[-+*/]/.test(commissionCalculationSurface), 'Commission calculation must not use paid amount');
assert(!/delivery_fee_cents\s*[-+*/]/.test(commissionCalculationSurface), 'Delivery fee must not participate in commission calculation');
assert(!/refund_amount_cents\s*[-+*/]/.test(commissionCalculationSurface), 'Total refund amount must not drive commission calculation');

type RewardCase = {
  product_amount_cents: number;
  delivery_fee_cents: number;
  pay_amount_cents: number;
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  refund_amount_cents: number;
  commission_value: number;
};
function expectedPercentReward(input: RewardCase) {
  const originalProductAmountCents = input.product_amount_cents;
  const remainingProductAmountCents = Math.max(0, originalProductAmountCents - input.product_refund_amount_cents);
  return Math.floor((remainingProductAmountCents * input.commission_value) / 100);
}
const baseRewardCase = { product_amount_cents: 10000, delivery_fee_cents: 500, pay_amount_cents: 10500, product_refund_amount_cents: 0, delivery_refund_amount_cents: 0, refund_amount_cents: 0, commission_value: 10 };
assert(expectedPercentReward(baseRewardCase) === 1000, 'Initial reward must be 1000 and must not include delivery fee');
assert(expectedPercentReward({ ...baseRewardCase, delivery_refund_amount_cents: 500, refund_amount_cents: 500 }) === 1000, 'Delivery-fee-only refund must not change reward');
assert(expectedPercentReward({ ...baseRewardCase, product_refund_amount_cents: 3000, delivery_refund_amount_cents: 500, refund_amount_cents: 3500 }) === 700, 'Product refund must recalculate reward to 700 even when total refund includes delivery fee');
assert(expectedPercentReward({ ...baseRewardCase, product_refund_amount_cents: 10000, refund_amount_cents: 10500 }) === 0, 'Full product refund must zero reward');
includesAll('scripts/generate-stage-report.ts', ['const l39Manifest', 'L39 delivery refund finance baseline', 'POST /api/after-sales', 'GET /api/admin/finance/refund-ledger/export.csv', 'scripts/verify-docker-api-e2e-local.ts']);
includesAll('scripts/verify-docker-api-e2e-local.ts', ['base_fee_cents: 500', 'requested_product_refund_cents: 100', 'requested_delivery_refund_cents: 200', 'approved_product_refund_cents: 100', 'approved_delivery_refund_cents: 200', 'total_product_refund_amount_cents >= 100', 'total_delivery_refund_amount_cents >= 200', 'product_refund_amount_cents', 'delivery_refund_amount_cents', 'store delivery refund must fail']);
includesAll('docs/reviews/l39-delivery-refund-finance-baseline.md', ['配送费退款策略', '总退款金额必须等于商品退款金额加配送费退款金额', '不启用、不调用、不纳入 L39 行为与验收']);

const runtimeFiles = [
  'apps/api/src/services/refund-service.ts',
  'apps/api/src/modules/after-sale/after-sale-service.ts',
  'apps/api/src/modules/finance/finance-report-service.ts',
  'apps/api/src/modules/user-orders/user-order-service.ts',
  'apps/api/src/routes/refunds.ts',
  'apps/api/src/routes/after-sales.ts',
  'apps/admin/src/api/financeRefundLedger.ts',
  'apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx',
  'apps/miniapp/pages/orders/detail/index.js',
  'apps/miniapp/pages/after-sales/detail/index.js'
];
const runtimeSource = runtimeFiles.map(read).join('\n');
excludesAllText('runtime source', runtimeSource, ['parent_'+'leader_id', 'up'+'line_id', 'team_'+'id', 'wx.request'+'Payment', 'autoPayout', 'autoTax', 'axios.post', 'fetch("https://api.mch.weixin.qq.com', "fetch('https://api.mch.weixin.qq.com"]);
const refundRoutes = read('apps/api/src/routes/refunds.ts');
assert(!refundRoutes.includes('/api/refunds/wechat/apply'), 'Public wechat refund apply route must remain retired');
assert(refundRoutes.includes('/api/refunds/wechat/notify'), 'Verified Wechat refund notify route must remain registered');
assert(refundRoutes.includes("if (paymentMode !== 'wechat')") && refundRoutes.includes('reply.code(403)'), 'Wechat refund notify must remain fail-closed outside real Wechat mode');
assert(refundRoutes.includes('if (!request.rawBody)') && refundRoutes.includes('reply.code(400)'), 'Wechat refund notify must reject missing raw bytes');
assert(refundRoutes.includes('return reply.code(204).send()'), 'Verified Wechat refund notify must acknowledge success without a response body');
assert(refundRoutes.includes('? 400') && refundRoutes.includes(': 500'), 'Wechat refund notify must separate rejected callbacks from internal failures');
assert(!refundRoutes.includes('reply.code(501)'), 'Retired Wechat refund notify placeholder must not return');
console.log('L39 delivery refund finance baseline verification passed.');
