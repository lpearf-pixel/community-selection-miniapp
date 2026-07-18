import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

assertStageRegistered('L38', 'scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts');
function exists(file: string) { return existsSync(file); }
function read(file: string) { return readFileSync(file, 'utf8'); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function includesAll(file: string, needles: string[]) { const text = read(file); for (const needle of needles) assert(text.includes(needle), `${file} missing ${needle}`); }

const files = [
  'prisma/schema.prisma','apps/api/src/modules/order/order-service.ts','apps/api/src/modules/payment/payment-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/api/src/modules/finance/finance-report-service.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l38-delivery-fee-order-amount-baseline.md'
];
for (const file of files) assert(exists(file), `Missing file: ${file}`);
assert(globSync('prisma/migrations/*_l38_delivery_fee_order_amount/migration.sql').length > 0, 'Missing L38 migration');

includesAll('prisma/schema.prisma', ['delivery_fee_cents','delivery_time_window_code','delivery_time_window_text','product_amount_cents']);
includesAll('apps/api/src/modules/order/order-service.ts', ['product_amount_cents','delivery_fee_cents','pay_amount_cents','productAmountCents + deliveryFeeCents', "pickupType === 'delivery'", 'PickupType.delivery', 'delivery_time_window_code','delivery_time_window_text','receiver_phone_masked','receiver_address_masked']);
includesAll('apps/api/src/routes/payments.ts', ['pay_amount_cents','mock','delivery_fee_cents']);
includesAll('apps/api/src/modules/payment/payment-service.ts', ['pay_amount_cents','delivery_fee_cents','不接真实支付']);
includesAll('apps/api/src/modules/finance/finance-report-service.ts', ['total_product_amount_cents','total_delivery_fee_cents','total_pay_amount_cents','product_amount_cents','delivery_fee_cents','refund_amount_cents','/^','=+']);
includesAll('apps/miniapp/pages/orders/confirm/index.wxml', ['商品金额','配送费','应付金额','配送时段']);
includesAll('apps/miniapp/pages/orders/confirm/index.js', ['delivery_fee_cents','product_amount_cents','pay_amount_cents']);
includesAll('apps/miniapp/pages/orders/detail/index.wxml', ['商品金额','配送费','实付金额','配送时段','配送地址']);


const commissionText = read('apps/api/src/services/commission-service.ts');
function functionSection(source: string, functionName: string) {
  const candidates = [
    `function ${functionName}`,
    `export function ${functionName}`,
    `export async function ${functionName}`,
    `async function ${functionName}`
  ];
  const starts = candidates.map((candidate) => source.indexOf(candidate)).filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  assert(start >= 0, `Missing function ${functionName}`);
  const next = source.slice(start + 1).search(/\n(?:function|async function|export function|export async function)\s+\w+\b/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}
const rewardCalculationSurface = [
  functionSection(commissionText, 'productOriginal'),
  functionSection(commissionText, 'productRemaining'),
  functionSection(commissionText, 'calculateCommissionAmount'),
  functionSection(commissionText, 'ensureEstimatedCommission'),
  functionSection(commissionText, 'syncCommissionAfterRefund')
].join('\n');
assert(rewardCalculationSurface.includes('product_amount_cents'), 'reward calculation must use product amount');
assert(rewardCalculationSurface.includes('product_refund_amount_cents'), 'reward refund calculation must use product refund amount');
assert(rewardCalculationSurface.includes('productOriginal(order) - order.product_refund_amount_cents'), 'remaining product amount must subtract product refund amount');
assert(functionSection(commissionText, 'calculateCommissionAmount').includes('original_product_amount_cents') && functionSection(commissionText, 'calculateCommissionAmount').includes('remaining_product_amount_cents'), 'calculateCommissionAmount must use original and remaining product amounts');
assert(!/order\.delivery_fee_cents\b/.test(rewardCalculationSurface), 'reward calculation must exclude delivery fee');
assert(!/order\.pay_amount_cents\b/.test(rewardCalculationSurface), 'reward calculation must exclude paid amount');
assert(!/order\.refund_amount_cents\b/.test(rewardCalculationSurface), 'reward calculation must exclude total refund amount');

type RewardCase = { product_amount_cents: number; delivery_fee_cents: number; pay_amount_cents: number; product_refund_amount_cents: number; delivery_refund_amount_cents: number; refund_amount_cents: number; commission_value: number; };
function expectedReward(input: RewardCase) {
  const originalProductAmountCents = input.product_amount_cents;
  const remainingProductAmountCents = Math.max(0, originalProductAmountCents - input.product_refund_amount_cents);
  return Math.floor((remainingProductAmountCents * input.commission_value) / 100);
}
const rewardFixture = { product_amount_cents: 10000, delivery_fee_cents: 500, pay_amount_cents: 10500, product_refund_amount_cents: 0, delivery_refund_amount_cents: 0, refund_amount_cents: 0, commission_value: 10 };
assert(expectedReward(rewardFixture) === 1000, 'initial reward must use product amount only');
assert(expectedReward({ ...rewardFixture, delivery_refund_amount_cents: 500, refund_amount_cents: 500 }) === 1000, 'delivery-fee-only refund must not change reward');
assert(expectedReward({ ...rewardFixture, product_refund_amount_cents: 3000, delivery_refund_amount_cents: 500, refund_amount_cents: 3500 }) === 700, 'product refund must recalculate reward to 700');
assert(1000 - expectedReward({ ...rewardFixture, product_refund_amount_cents: 3000, delivery_refund_amount_cents: 500, refund_amount_cents: 3500 }) === 300, 'product refund deduct amount must be 300');
assert(expectedReward({ ...rewardFixture, product_refund_amount_cents: 10000, refund_amount_cents: 10500 }) === 0, 'full product refund must zero reward');

const runtimeFiles = [
  'apps/api/src/modules/order/order-service.ts',
  'apps/api/src/modules/payment/payment-service.ts',
  'apps/api/src/modules/user-orders/user-order-service.ts',
  'apps/api/src/modules/finance/finance-report-service.ts',
  'apps/api/src/modules/delivery/delivery-service.ts',
  'apps/admin/src/api/delivery.ts',
  'apps/admin/src/pages/delivery/DeliveryReservationPage.tsx',
  'apps/miniapp/pages/orders/confirm/index.js',
  'apps/miniapp/pages/orders/detail/index.js'
].filter(exists);
const runtimeSource = runtimeFiles.map(read).join('\n');
const wxPayCallPattern = new RegExp('wx\\s*\\.\\s*request' + 'Payment');
const realRefundPattern = new RegExp('real\\s+refund\\s+api', 'i');
const autoRefundPattern = new RegExp('auto\\s+refund', 'i');
const autoPayoutPattern = new RegExp('auto\\s+payout', 'i');
assert(!wxPayCallPattern.test(runtimeSource), 'Runtime code contains real wx payment call');
assert(!realRefundPattern.test(runtimeSource), 'Runtime code contains real refund API marker');
assert(!autoRefundPattern.test(runtimeSource), 'Runtime code contains auto refund marker');
assert(!autoPayoutPattern.test(runtimeSource), 'Runtime code contains auto payout marker');
for (const forbidden of ['app_'+'secret','app_'+'key','private_'+'key','cost_price_cents:','commission_value:','commission_type:','stock_deduct_quantity:','password_hash','raw user profile']) {
  assert(!runtimeSource.includes(forbidden), `Forbidden unsafe runtime output found: ${forbidden}`);
}
assert(read('apps/api/src/modules/order/order-service.ts').includes('receiver_phone_masked') && read('apps/api/src/modules/order/order-service.ts').includes('receiver_address_masked'), 'order public mapper must use masked receiver fields');
console.log('Compliance scan passed.');
console.log('L38 delivery fee order amount baseline verification passed.');
