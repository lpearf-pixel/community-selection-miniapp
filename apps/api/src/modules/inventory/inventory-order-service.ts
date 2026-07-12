import type { Prisma } from '@prisma/client';

type OrderStockInput = { id: string; quantity: number; product_id: string | null; group_buy?: { product_id: string } | null };
export type InventoryEventResult = {
  applied: boolean;
  idempotent: boolean;
  event_type: string;
  quantity: number;
  before_stock: number;
  after_stock: number;
  ledger_id: string | null;
};

export type OrderInventorySummary = {
  deducted_quantity: number;
  restored_quantity: number;
  remaining_restorable_quantity: number;
  current_product_stock: number;
  latest_inventory_event: string | null;
};

const deductEventType = 'order_paid_deduct';
const restoreEventTypes = ['refund_success_restore', 'group_failed_refund_restore', 'manual_restock'] as const;

export const inventoryIdempotencyPrefixes = {
  orderPaidDeduct: 'order-paid-deduct',
  refundSuccessRestore: 'refund-success-restore',
  groupFailedRefundRestore: 'group-failed-refund-restore',
  manualRestock: 'manual-restock'
} as const;

export function buildInventoryIdempotencyKey(prefix: string, sourceId: string) {
  return `${prefix}:${sourceId}`;
}

export function getInventoryIdempotencyPrefix(eventType: string) {
  if (eventType === 'order_paid_deduct') return inventoryIdempotencyPrefixes.orderPaidDeduct;
  if (eventType === 'group_failed_refund_restore') return inventoryIdempotencyPrefixes.groupFailedRefundRestore;
  if (eventType === 'manual_restock') return inventoryIdempotencyPrefixes.manualRestock;
  return inventoryIdempotencyPrefixes.refundSuccessRestore;
}

function assertPositiveInteger(value: number, message: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(message);
}

export function resolveOrderProductId(order: OrderStockInput) {
  return order.product_id ?? order.group_buy?.product_id ?? null;
}

export function calculateOrderStockQuantity(order: { quantity: number }, product: { stock_deduct_quantity: number | null }) {
  assertPositiveInteger(order.quantity, '订单商品数量非法');
  const stockDeductQuantity = product.stock_deduct_quantity ?? 1;
  assertPositiveInteger(stockDeductQuantity, '库存扣减数量非法');
  return order.quantity * stockDeductQuantity;
}

async function existingResult(tx: Prisma.TransactionClient, idempotencyKey: string, eventType: string): Promise<InventoryEventResult | null> {
  const ledger = await tx.stockLedger.findUnique({ where: { idempotency_key: idempotencyKey } });
  if (!ledger) return null;
  return { applied: false, idempotent: true, event_type: ledger.event_type || eventType, quantity: Math.abs(ledger.quantity_delta || ledger.quantity), before_stock: ledger.stock_before, after_stock: ledger.stock_after, ledger_id: ledger.id };
}

export async function deductInventoryForPaidOrder(tx: Prisma.TransactionClient, input: { order: OrderStockInput; operator_user_id?: string | null }): Promise<InventoryEventResult> {
  const idempotencyKey = buildInventoryIdempotencyKey(inventoryIdempotencyPrefixes.orderPaidDeduct, input.order.id);
  const existing = await existingResult(tx, idempotencyKey, deductEventType);
  if (existing) return existing;
  const productId = resolveOrderProductId(input.order);
  if (!productId) throw new Error('商品不存在');
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('商品不存在');
  const quantity = calculateOrderStockQuantity(input.order, product);
  const updated = await tx.product.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
  if (updated.count !== 1) throw new Error('库存不足');
  const after = await tx.product.findUniqueOrThrow({ where: { id: product.id } });
  const beforeStock = after.stock + quantity;
  const ledger = await tx.stockLedger.create({ data: { product_id: product.id, source_type: 'order_payment', source_id: input.order.id, idempotency_key: idempotencyKey, event_type: deductEventType, quantity_delta: -quantity, order_id: input.order.id, direction: 'out', quantity, stock_before: beforeStock, stock_after: after.stock, operator_type: 'system', operator_id: input.operator_user_id ?? null, remark: '支付成功扣减库存', payload: { order_id: input.order.id, stock_deduct_quantity: product.stock_deduct_quantity, order_quantity: input.order.quantity } } });
  return { applied: true, idempotent: false, event_type: deductEventType, quantity, before_stock: beforeStock, after_stock: after.stock, ledger_id: ledger.id };
}

async function stockTotals(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.stockLedger.findMany({ where: { order_id: orderId }, select: { event_type: true, source_type: true, quantity_delta: true, quantity: true, direction: true } });
  let deducted = 0;
  let restored = 0;
  for (const row of rows) {
    const delta = row.quantity_delta || (row.direction === 'out' ? -Math.abs(row.quantity) : Math.abs(row.quantity));
    if (row.event_type === deductEventType || row.source_type === 'order_payment' || row.source_type === 'order_lock') deducted += Math.abs(delta);
    if ((restoreEventTypes as readonly string[]).includes(row.event_type) || row.source_type === 'refund_restore') restored += Math.max(0, delta);
  }
  return { deducted, restored, remaining: Math.max(0, deducted - restored) };
}

export async function restoreInventoryForRefund(tx: Prisma.TransactionClient, input: { refund_id: string; event_type?: 'refund_success_restore' | 'group_failed_refund_restore' | 'manual_restock'; restore_quantity?: number | null }): Promise<InventoryEventResult> {
  const refund = await tx.refund.findUnique({ where: { id: input.refund_id }, include: { order: { include: { group_buy: true } } } });
  if (!refund) throw new Error('退款单不存在');
  if (refund.status !== 'success') throw new Error('退款尚未成功');
  if (refund.order.pay_status !== 'paid') throw new Error('订单未支付不能执行退款回补');
  const eventType = input.event_type ?? (refund.order.group_buy?.status === 'failed' ? 'group_failed_refund_restore' : 'refund_success_restore');
  const prefix = getInventoryIdempotencyPrefix(eventType);
  const idempotencyKey = buildInventoryIdempotencyKey(prefix, refund.id);
  const existing = await existingResult(tx, idempotencyKey, eventType);
  if (existing) return existing;
  const productId = refund.order.product_id ?? refund.order.group_buy?.product_id ?? null;
  if (!productId) throw new Error('商品不存在');
  const totals = await stockTotals(tx, refund.order_id);
  const productPaid = refund.order.product_amount_cents ?? refund.order.total_amount_cents;
  const fullProductRefund = refund.order.product_refund_amount_cents >= productPaid;
  let quantity = input.restore_quantity ?? 0;
  if (quantity == null || quantity === 0) quantity = fullProductRefund ? totals.remaining : 0;
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error('库存回补数量非法');
  if (quantity === 0) return { applied: false, idempotent: false, event_type: eventType, quantity: 0, before_stock: 0, after_stock: 0, ledger_id: null };
  if (quantity > totals.remaining) throw new Error('回补数量超过剩余可回补数量');
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('商品不存在');
  await tx.product.update({ where: { id: product.id }, data: { stock: { increment: quantity } } });
  const after = await tx.product.findUniqueOrThrow({ where: { id: product.id } });
  const ledger = await tx.stockLedger.create({ data: { product_id: product.id, source_type: 'order_refund', source_id: refund.order_id, idempotency_key: idempotencyKey, event_type: eventType, quantity_delta: quantity, order_id: refund.order_id, refund_id: refund.id, direction: 'in', quantity, stock_before: product.stock, stock_after: after.stock, operator_type: 'system', remark: eventType === 'group_failed_refund_restore' ? '团购失败退款库存回补' : '退款成功库存回补', payload: { refund_id: refund.id, product_refund_amount_cents: refund.product_refund_amount_cents, delivery_refund_amount_cents: refund.delivery_refund_amount_cents } } });
  await tx.refund.update({ where: { id: refund.id }, data: { stock_restored: true } });
  return { applied: true, idempotent: false, event_type: eventType, quantity, before_stock: product.stock, after_stock: after.stock, ledger_id: ledger.id };
}

export async function getOrderInventorySummary(tx: Prisma.TransactionClient, orderId: string): Promise<OrderInventorySummary> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { group_buy: true } });
  if (!order) throw new Error('订单不存在');
  const productId = order.product_id ?? order.group_buy?.product_id ?? null;
  const totals = await stockTotals(tx, orderId);
  const product = productId ? await tx.product.findUnique({ where: { id: productId } }) : null;
  const latest = await tx.stockLedger.findFirst({ where: { order_id: orderId }, orderBy: { created_at: 'desc' } });
  return { deducted_quantity: totals.deducted, restored_quantity: totals.restored, remaining_restorable_quantity: totals.remaining, current_product_stock: product?.stock ?? 0, latest_inventory_event: latest?.event_type ?? null };
}
