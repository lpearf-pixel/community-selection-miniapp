import { assertStageRegistered } from './stage-verifier-registration.ts';
import { readFileSync } from 'node:fs';
import { prisma } from '../apps/api/src/db.js';
import { createNormalOrder } from '../apps/api/src/modules/order/order-service.js';
import { buildInventoryIdempotencyKey, deductInventoryForPaidOrder, getInventoryIdempotencyPrefix, getOrderInventorySummary, inventoryIdempotencyPrefixes, restoreInventoryForRefund } from '../apps/api/src/modules/inventory/inventory-order-service.js';
import { markOrderPaid } from '../apps/api/src/services/payment-service.js';

assertStageRegistered('L41', 'scripts/verify-l41-inventory-deduct-restore-local.ts');
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string) { return readFileSync(path, 'utf8'); }

async function main() {
  const schema = read('prisma/schema.prisma');
  for (const field of ['idempotency_key', 'event_type', 'quantity_delta', 'order_id', 'refund_id', 'after_sale_case_id']) assert(schema.includes(field), `StockLedger missing ${field}`);
  assert(schema.includes('@unique'), 'StockLedger idempotency_key must be unique');
  const service = read('apps/api/src/modules/inventory/inventory-order-service.ts');
  for (const text of ['inventoryIdempotencyPrefixes', 'updateMany', 'stock: { gte: quantity }', 'order-paid-deduct', 'refund-success-restore', 'group-failed-refund-restore', 'buildInventoryIdempotencyKey', 'delivery_refund_amount_cents']) assert(service.includes(text), `inventory service missing ${text}`);
  assert(service.includes('`${prefix}:${sourceId}`') || service.includes('${prefix}:${sourceId}'), 'inventory service missing structured idempotency key builder');
  assert(buildInventoryIdempotencyKey(inventoryIdempotencyPrefixes.orderPaidDeduct, 'order-1') === 'order-paid-deduct:order-1', 'paid deduction prefix builder incorrect');
  assert(buildInventoryIdempotencyKey(getInventoryIdempotencyPrefix('refund_success_restore'), 'refund-1') === 'refund-success-restore:refund-1', 'refund restore prefix builder incorrect');
  assert(buildInventoryIdempotencyKey(getInventoryIdempotencyPrefix('group_failed_refund_restore'), 'refund-2') === 'group-failed-refund-restore:refund-2', 'group failed refund restore prefix builder incorrect');
  assert(buildInventoryIdempotencyKey(getInventoryIdempotencyPrefix('manual_restock'), 'manual-1') === 'manual-restock:manual-1', 'manual restock prefix builder incorrect');
  const payment = read('apps/api/src/services/payment-service.ts');
  assert(payment.includes('deductInventoryForPaidOrder'), 'payment service must deduct inventory during paid confirmation');
  const refund = read('apps/api/src/services/refund-service.ts');
  assert(refund.includes('restoreInventoryForRefund'), 'refund service must restore inventory through unified service');
  const adminOrders = read('apps/api/src/routes/admin/orders.ts');
  assert(adminOrders.includes('/api/admin/orders/:id/inventory-summary') && adminOrders.includes('inventory_summary'), 'Admin order inventory summary API/data missing');

  const prefix = `l41-${Date.now()}`;
  const category = await prisma.category.create({ data: { name: `${prefix}-category` } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-openid`, nickname: 'L41 user' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 1000, cost_price_cents: 500, stock: 20, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 2, status: 'active' } });
  const order = await prisma.order.create({ data: { order_no: `${prefix}-order`, user_id: user.id, product_id: product.id, total_amount_cents: 3000, product_amount_cents: 3000, pay_amount_cents: 3000, quantity: 3, receiver_name: 'L41', receiver_phone: '13800000000' } });
  await prisma.$transaction((tx) => deductInventoryForPaidOrder(tx, { order }));
  assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === 14, 'paid order must deduct 6 stock');
  await prisma.$transaction((tx) => deductInventoryForPaidOrder(tx, { order }));
  assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === 14, 'duplicate paid event must not deduct twice');
  assert(await prisma.stockLedger.count({ where: { order_id: order.id, event_type: 'order_paid_deduct' } }) === 1, 'deduct ledger must be unique');
  const deductLedger = await prisma.stockLedger.findFirst({ where: { order_id: order.id, event_type: 'order_paid_deduct' } });
  assert(deductLedger?.idempotency_key === `order-paid-deduct:${order.id}`, 'paid deduction idempotency key incorrect');

  const poorProduct = await prisma.product.create({ data: { name: `${prefix}-poor`, category_id: category.id, price_cents: 1000, cost_price_cents: 500, stock: 2, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 3, status: 'active' } });
  const poorOrder = await prisma.order.create({ data: { order_no: `${prefix}-poor-order`, user_id: user.id, product_id: poorProduct.id, total_amount_cents: 1000, product_amount_cents: 1000, pay_amount_cents: 1000, quantity: 1, receiver_name: 'L41', receiver_phone: '13800000000' } });
  let insufficient = false;
  try { await prisma.$transaction((tx) => deductInventoryForPaidOrder(tx, { order: poorOrder })); } catch (error) { insufficient = String(error).includes('库存不足'); }
  assert(insufficient, 'insufficient stock must fail');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: poorProduct.id } })).stock === 2, 'insufficient stock must remain unchanged');

  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-store`, address: 'L41 store address', phone: '13800000000', status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L41 community address', status: 'active' } });
  const zeroProduct = await prisma.product.create({ data: { name: `${prefix}-zero-stock`, category_id: category.id, price_cents: 1200, cost_price_cents: 600, stock: 0, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, status: 'active' } });
  const zeroOrderPublic = await createNormalOrder({ product_id: zeroProduct.id, user_openid: `${prefix}-zero-openid`, client_request_id: `${prefix}-zero-order`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L41 zero stock', receiver_phone: '13800000000' });
  const zeroOrder = await prisma.order.findUniqueOrThrow({ where: { id: zeroOrderPublic.id } });
  assert(zeroOrder.pay_status === 'unpaid' && zeroOrder.order_status === 'unpaid', 'zero-stock normal order must be created as unpaid');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: zeroProduct.id } })).stock === 0, 'zero-stock order creation must not change Product.stock');
  assert(await prisma.stockLedger.count({ where: { order_id: zeroOrder.id, event_type: 'order_paid_deduct' } }) === 0, 'zero-stock order creation must not write paid deduct ledger');
  let zeroPaymentFailed = false;
  try { await markOrderPaid(zeroOrder.id); } catch (error) { zeroPaymentFailed = String(error).includes('库存不足'); }
  assert(zeroPaymentFailed, 'zero-stock order payment must fail with insufficient stock');
  const zeroOrderAfterPaymentAttempt = await prisma.order.findUniqueOrThrow({ where: { id: zeroOrder.id } });
  assert(zeroOrderAfterPaymentAttempt.pay_status === 'unpaid' && zeroOrderAfterPaymentAttempt.order_status === 'unpaid', 'zero-stock order must remain unpaid after failed payment');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: zeroProduct.id } })).stock === 0, 'failed payment must not change zero-stock Product.stock');
  assert(await prisma.stockLedger.count({ where: { order_id: zeroOrder.id, event_type: 'order_paid_deduct' } }) === 0, 'failed payment must not write paid deduct ledger');

  await prisma.order.update({ where: { id: order.id }, data: { pay_status: 'paid', order_status: 'paid', refund_amount_cents: 3000, product_refund_amount_cents: 3000, refund_status: 'success' } });
  const refundRow = await prisma.refund.create({ data: { order_id: order.id, out_refund_no: `${prefix}-refund`, client_refund_id: `${prefix}-refund`, refund_amount_cents: 3000, product_refund_amount_cents: 3000, delivery_refund_amount_cents: 0, reason: 'L41 full refund', status: 'success', processed_at: new Date() } });
  await prisma.$transaction((tx) => restoreInventoryForRefund(tx, { refund_id: refundRow.id }));
  await prisma.$transaction((tx) => restoreInventoryForRefund(tx, { refund_id: refundRow.id }));
  assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === 20, 'full refund must restore once');
  const restoreLedger = await prisma.stockLedger.findFirst({ where: { refund_id: refundRow.id, event_type: 'refund_success_restore' } });
  assert(restoreLedger?.idempotency_key === `refund-success-restore:${refundRow.id}`, 'refund restore idempotency key incorrect');

  const summary = await prisma.$transaction((tx) => getOrderInventorySummary(tx, order.id));
  assert(summary.deducted_quantity === 6 && summary.restored_quantity === 6 && summary.remaining_restorable_quantity === 0 && summary.current_product_stock === 20, 'Admin inventory summary incorrect');
  assert((await prisma.product.count({ where: { stock: { lt: 0 } } })) === 0, 'Product.stock must never be negative');
  assert(!read('docs/plans/next-stage-development-plan.md').includes('L41：库存扣减') || !service.includes('L42'), 'must not implement L42');
  console.log('L41 inventory deduct restore verification passed.');
}

main().finally(async () => prisma.$disconnect());
