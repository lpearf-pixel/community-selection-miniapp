import { readFileSync } from 'node:fs';
import { prisma } from '../apps/api/src/db.js';
import { deductInventoryForPaidOrder, getOrderInventorySummary, restoreInventoryForRefund } from '../apps/api/src/modules/inventory/inventory-order-service.js';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string) { return readFileSync(path, 'utf8'); }

async function main() {
  const schema = read('prisma/schema.prisma');
  for (const field of ['idempotency_key', 'event_type', 'quantity_delta', 'order_id', 'refund_id', 'after_sale_case_id']) assert(schema.includes(field), `StockLedger missing ${field}`);
  assert(schema.includes('@unique'), 'StockLedger idempotency_key must be unique');
  const service = read('apps/api/src/modules/inventory/inventory-order-service.ts');
  for (const text of ['updateMany', 'stock: { gte: quantity }', 'order-paid-deduct:', 'refund-success-restore:', 'group-failed-refund-restore:', 'delivery_refund_amount_cents']) assert(service.includes(text), `inventory service missing ${text}`);
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

  const poorProduct = await prisma.product.create({ data: { name: `${prefix}-poor`, category_id: category.id, price_cents: 1000, cost_price_cents: 500, stock: 2, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 3, status: 'active' } });
  const poorOrder = await prisma.order.create({ data: { order_no: `${prefix}-poor-order`, user_id: user.id, product_id: poorProduct.id, total_amount_cents: 1000, product_amount_cents: 1000, pay_amount_cents: 1000, quantity: 1, receiver_name: 'L41', receiver_phone: '13800000000' } });
  let insufficient = false;
  try { await prisma.$transaction((tx) => deductInventoryForPaidOrder(tx, { order: poorOrder })); } catch (error) { insufficient = String(error).includes('库存不足'); }
  assert(insufficient, 'insufficient stock must fail');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: poorProduct.id } })).stock === 2, 'insufficient stock must remain unchanged');

  await prisma.order.update({ where: { id: order.id }, data: { pay_status: 'paid', order_status: 'paid', refund_amount_cents: 3000, product_refund_amount_cents: 3000, refund_status: 'success' } });
  const refundRow = await prisma.refund.create({ data: { order_id: order.id, out_refund_no: `${prefix}-refund`, client_refund_id: `${prefix}-refund`, refund_amount_cents: 3000, product_refund_amount_cents: 3000, delivery_refund_amount_cents: 0, reason: 'L41 full refund', status: 'success', processed_at: new Date() } });
  await prisma.$transaction((tx) => restoreInventoryForRefund(tx, { refund_id: refundRow.id }));
  await prisma.$transaction((tx) => restoreInventoryForRefund(tx, { refund_id: refundRow.id }));
  assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === 20, 'full refund must restore once');

  const summary = await prisma.$transaction((tx) => getOrderInventorySummary(tx, order.id));
  assert(summary.deducted_quantity === 6 && summary.restored_quantity === 6 && summary.remaining_restorable_quantity === 0 && summary.current_product_stock === 20, 'Admin inventory summary incorrect');
  assert((await prisma.product.count({ where: { stock: { lt: 0 } } })) === 0, 'Product.stock must never be negative');
  assert(!read('docs/plans/next-stage-development-plan.md').includes('L41：库存扣减') || !service.includes('L42'), 'must not implement L42');
  console.log('L41 inventory deduct restore verification passed.');
}

main().finally(async () => prisma.$disconnect());
