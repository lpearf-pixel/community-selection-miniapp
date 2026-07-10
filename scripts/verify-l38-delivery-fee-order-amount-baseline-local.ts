import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

function read(file: string) { return readFileSync(file, 'utf8'); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function includesAll(file: string, needles: string[]) { const text = read(file); for (const needle of needles) assert(text.includes(needle), `${file} missing ${needle}`); }

const files = [
  'prisma/schema.prisma','apps/api/src/modules/order/order-service.ts','apps/api/src/modules/payment/payment-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/api/src/modules/finance/finance-report-service.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l38-delivery-fee-order-amount-baseline.md'
];
for (const file of files) assert(existsSync(file), `Missing file: ${file}`);
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
assert(commissionText.includes('product_amount_cents') && commissionText.includes('delivery_fee_cents 不参与'), 'reward calculation must exclude delivery fee');

const combined = files.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')).map(read).join('\n');
for (const forbidden of ['app_'+'secret','app_'+'key','private_'+'key','wx.'+'requestPayment','real '+'refund API','auto '+'refund','auto '+'payout','cost_price_cents:','commission_value:','commission_type:','stock_deduct_quantity:','password_hash','raw user profile']) {
  assert(!combined.includes(forbidden), `Forbidden unsafe output found: ${forbidden}`);
}
assert(read('apps/api/src/modules/order/order-service.ts').includes('receiver_phone_masked') && read('apps/api/src/modules/order/order-service.ts').includes('receiver_address_masked'), 'order public mapper must use masked receiver fields');
console.log('Compliance scan passed.');
console.log('L38 delivery fee order amount baseline verification passed.');
