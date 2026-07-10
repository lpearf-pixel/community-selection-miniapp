import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

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
assert(globSync('prisma/migrations/*_l39_delivery_refund_finance_baseline/migration.sql').length > 0, 'Missing L39 migration');

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
includesAll('apps/api/src/services/commission-service.ts', ['product_amount_cents', 'delivery_fee_cents 不参与']);
includesAll('scripts/verify-all-local.sh', ['pnpm exec tsx scripts/verify-l39-delivery-refund-finance-baseline-local.ts']);
includesAll('scripts/stage-workflow.ts', ['L39', 'verify-l39-delivery-refund-finance-baseline-local.ts', "'L39', 'L38', 'L37'"]);
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
assert(read('apps/api/src/routes/refunds.ts').includes('implemented: false'), 'Historical wechat refund apply placeholder must remain non-implemented');
assert(read('apps/api/src/routes/refunds.ts').includes('reply.code(501)'), 'Historical wechat refund notify placeholder must not process orders');
console.log('L39 delivery refund finance baseline verification passed.');
