import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

function read(file: string) { return readFileSync(file, 'utf8'); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function includesAll(file: string, needles: string[]) { const text = read(file); for (const needle of needles) assert(text.includes(needle), `${file} missing ${needle}`); }

const files = [
  'prisma/schema.prisma',
  'apps/api/src/services/refund-service.ts',
  'apps/api/src/modules/after-sale/after-sale-service.ts',
  'apps/api/src/modules/finance/finance-report-service.ts',
  'apps/api/src/modules/user-orders/user-order-service.ts',
  'apps/api/src/routes/refunds.ts',
  'apps/api/src/routes/after-sales.ts',
  'apps/admin/src/api/financeRefundLedger.ts',
  'apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx',
  'apps/miniapp/pages/orders/detail/index.wxml',
  'apps/miniapp/pages/after-sales/detail/index.wxml',
  'scripts/verify-l39-delivery-refund-finance-baseline-local.ts',
  'scripts/stage-workflow.ts'
];
for (const file of files) assert(existsSync(file), `Missing file: ${file}`);
assert(globSync('prisma/migrations/*_l39_delivery_refund_finance_baseline/migration.sql').length > 0, 'Missing L39 migration');

includesAll('prisma/schema.prisma', ['product_refund_amount_cents', 'delivery_refund_amount_cents', 'requested_product_refund_cents', 'approved_delivery_refund_cents']);
includesAll('apps/api/src/services/refund-service.ts', ['allocateRefundSplit', '商品退款金额', '配送费退款金额', 'remainingRefundableAmount', 'product_refund_amount_cents', 'delivery_refund_amount_cents']);
includesAll('apps/api/src/modules/after-sale/after-sale-service.ts', ['requested_product_refund_cents', 'requested_delivery_refund_cents', 'approved_product_refund_cents', 'approved_delivery_refund_cents']);
includesAll('apps/api/src/modules/finance/finance-report-service.ts', ['product_refund_amount_cents', 'delivery_refund_amount_cents', 'remaining_refundable_amount_cents']);
includesAll('apps/api/src/modules/user-orders/user-order-service.ts', ['refund_split', 'remaining_refundable_amount_cents', 'requested_product_refund_cents']);
includesAll('apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx', ['商品退款合计', '配送费退款合计', '剩余可退合计']);
includesAll('apps/miniapp/pages/orders/detail/index.wxml', ['已退商品金额', '已退配送费', '剩余可退']);
includesAll('apps/miniapp/pages/after-sales/detail/index.wxml', ['商品退款', '配送费退款']);
includesAll('scripts/stage-workflow.ts', ['L39', 'verify-l39-delivery-refund-finance-baseline-local.ts']);

const runtimeSource = files.filter((file) => file.startsWith('apps/')).map(read).join('\n');
for (const forbidden of ['parent_'+'leader_id', 'up'+'line_id', 'team_'+'id', 'wx.request'+'Payment']) {
  assert(!runtimeSource.includes(forbidden), `Forbidden runtime marker found: ${forbidden}`);
}
console.log('L39 delivery refund finance baseline verification passed.');
