import { OrderStatus, Prisma, RefundStatus } from '@prisma/client';
import { prisma } from '../../db.js';

type Query = { from?: string; to?: string; community_id?: string; pickup_store_id?: string; status?: string; page?: number; page_size?: number; order_no?: string; group_buy_id?: string; refund_method?: string };

function dateWhere(query: Query): Prisma.DateTimeFilter | undefined {
  const where: Prisma.DateTimeFilter = {};
  if (query.from) where.gte = new Date(query.from);
  if (query.to) where.lte = new Date(query.to);
  return Object.keys(where).length ? where : undefined;
}

function toCents(value: number | null | undefined): number { return value ?? 0; }
function isOrderStatus(value: string | undefined): value is OrderStatus { return !!value && Object.values(OrderStatus).includes(value as OrderStatus); }
function isRefundStatus(value: string | undefined): value is RefundStatus { return !!value && Object.values(RefundStatus).includes(value as RefundStatus); }

function orderWhere(query: Query): Prisma.OrderWhereInput {
  return { created_at: dateWhere(query), community_id: query.community_id, pickup_store_id: query.pickup_store_id, order_status: isOrderStatus(query.status) ? query.status : undefined };
}
function sum(items: Array<number | null | undefined>): number { return items.reduce<number>((total, value) => total + toCents(value), 0); }

function maskPhone(phone: string | null | undefined): string { return phone && phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone ? '****' : ''; }
function refundMethod(refund: { provider_status: string | null }): string {
  return refund.provider_status?.startsWith('MANUAL_')
    ? refund.provider_status.slice('MANUAL_'.length).toLowerCase()
    : refund.provider_status === 'MOCK_SUCCESS'
      ? 'mock'
      : 'wechat';
}

function refundWhere(query: Query): Prisma.RefundWhereInput {
  return {
    created_at: dateWhere(query),
    status: isRefundStatus(query.status) ? query.status : undefined,
    order: {
      order_no: query.order_no ? { contains: query.order_no } : undefined,
      group_buy_id: query.group_buy_id,
      community_id: query.community_id,
      pickup_store_id: query.pickup_store_id
    }
  };
}

function refundLedgerRow(refund: Prisma.RefundGetPayload<{ include: { order: { include: { group_buy: { include: { product: true } } } } } }>) {
  return {
    refund_id: refund.id,
    order_id: refund.order_id,
    order_no: refund.order.order_no,
    group_buy_id: refund.order.group_buy_id,
    product_name: refund.order.group_buy?.product.name ?? '',
    refund_status: refund.status,
    refund_method: refundMethod(refund),
    refund_amount_cents: refund.refund_amount_cents,
    product_refund_amount_cents: refund.product_refund_amount_cents,
    delivery_refund_amount_cents: refund.delivery_refund_amount_cents,
    remaining_refundable_amount_cents: Math.max(0, refund.order.pay_amount_cents - refund.order.refund_amount_cents),
    refund_transaction_id: refund.refund_id ?? '',
    out_refund_no: refund.out_refund_no,
    manual_record_only: refund.provider_status?.startsWith('MANUAL_') ?? false,
    receiver_name: refund.order.receiver_name,
    receiver_phone_masked: maskPhone(refund.order.receiver_phone),
    reason: refund.reason,
    admin_remark: '',
    created_at: refund.created_at,
    processed_at: refund.processed_at
  };
}

export async function getFinanceRefundLedger(query: Query) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
  const where = refundWhere(query);
  const allRows = await prisma.refund.findMany({ where, include: { order: { include: { group_buy: { include: { product: true } } } } }, orderBy: { created_at: 'desc' } });
  const methodFiltered = query.refund_method ? allRows.filter((refund) => refundMethod(refund) === query.refund_method) : allRows;
  const items = methodFiltered.slice((page - 1) * pageSize, page * pageSize).map(refundLedgerRow);
  return { total: methodFiltered.length, page, page_size: pageSize, summary: { refund_count: methodFiltered.length, refund_amount_cents: sum(methodFiltered.map((item) => item.refund_amount_cents)), product_refund_amount_cents: sum(methodFiltered.map((item) => item.product_refund_amount_cents)), delivery_refund_amount_cents: sum(methodFiltered.map((item) => item.delivery_refund_amount_cents)), remaining_refundable_amount_cents: sum(methodFiltered.map((item) => Math.max(0, item.order.pay_amount_cents - item.order.refund_amount_cents))) }, items };
}

export async function getFinanceRefundLedgerCsv(query: Query) { return (await getFinanceRefundLedger({ ...query, page: 1, page_size: 100 })).items; }

export async function getFinanceOverview(query: Query) {
  const where = orderWhere(query);
  const orders = await prisma.order.findMany({ where, include: { commissions: true, after_sale_cases: true } });
  const orderIds = orders.map((order) => order.id);
  const [afterSaleCases, inventoryLosses, withdrawals] = await Promise.all([
    prisma.afterSaleCase.findMany({ where: { created_at: dateWhere(query), order_id: orderIds.length ? { in: orderIds } : undefined } }),
    prisma.inventoryLoss.findMany({ where: { created_at: dateWhere(query) }, include: { product: true } }),
    prisma.withdrawal.findMany({ where: { created_at: dateWhere(query) } })
  ]);
  const total_product_amount_cents = sum(orders.map((order) => order.product_amount_cents ?? order.total_amount_cents));
  const total_delivery_fee_cents = sum(orders.map((order) => order.delivery_fee_cents));
  const total_pay_amount_cents = sum(orders.map((order) => order.pay_amount_cents));
  const paidAmount = sum(orders.filter((order) => order.pay_status === 'paid').map((order) => order.pay_amount_cents));
  const refundedAmount = sum(orders.map((order) => order.refund_amount_cents));
  const productRefundedAmount = sum(orders.map((order) => order.product_refund_amount_cents));
  const deliveryRefundedAmount = sum(orders.map((order) => order.delivery_refund_amount_cents));
  return { total_product_amount_cents, total_delivery_fee_cents, total_pay_amount_cents, total_refund_amount_cents: refundedAmount, total_product_refund_amount_cents: productRefundedAmount, total_delivery_refund_amount_cents: deliveryRefundedAmount, remaining_refundable_amount_cents: sum(orders.map((order) => Math.max(0, order.pay_amount_cents - order.refund_amount_cents))), order_count: orders.length, paid_order_count: orders.filter((order) => order.pay_status === 'paid').length, completed_order_count: orders.filter((order) => order.order_status === 'completed').length, refunded_order_count: orders.filter((order) => order.refund_status !== 'none' || order.refund_amount_cents > 0).length, gross_sales_amount: sum(orders.map((order) => order.total_amount_cents)), paid_amount: paidAmount, refunded_amount: refundedAmount, net_sales_amount: paidAmount - refundedAmount, after_sale_case_count: afterSaleCases.length, after_sale_refund_amount: sum(afterSaleCases.map((item) => item.approved_refund_cents ?? item.requested_refund_cents)), inventory_loss_count: inventoryLosses.length, inventory_loss_estimated_amount: sum(inventoryLosses.map((loss) => loss.quantity * (loss.product.cost_price_cents ?? 0))), service_reward_estimated_amount: sum(orders.flatMap((order) => order.commissions.map((item) => item.final_amount_cents))), withdrawal_requested_amount: sum(withdrawals.map((item) => item.amount_cents)), withdrawal_paid_amount: sum(withdrawals.filter((item) => item.status === 'paid').map((item) => item.amount_cents)), tax_review_pending_count: withdrawals.filter((item) => item.tax_status === 'pending' || item.tax_mode === 'pending_review').length };
}

export async function getFinanceOrders(query: Query) {
  const page = Math.max(1, query.page ?? 1); const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20)); const where = orderWhere(query);
  const [total, rows] = await Promise.all([prisma.order.count({ where }), prisma.order.findMany({ where, include: { commissions: true, after_sale_cases: true }, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
  return { total, page, page_size: pageSize, items: rows.map((order) => ({ order_id: order.id, order_no: order.order_no, user_id: order.user_id, group_buy_id: order.group_buy_id, community_id: order.community_id, pickup_store_id: order.pickup_store_id, order_status: order.order_status, payment_status: order.pay_status, refund_status: order.refund_status, amount: order.total_amount_cents, product_amount_cents: order.product_amount_cents ?? order.total_amount_cents, delivery_fee_cents: order.delivery_fee_cents ?? 0, pay_amount_cents: order.pay_amount_cents, refund_amount_cents: order.refund_amount_cents, product_refund_amount_cents: order.product_refund_amount_cents, delivery_refund_amount_cents: order.delivery_refund_amount_cents, remaining_refundable_amount_cents: Math.max(0, order.pay_amount_cents - order.refund_amount_cents), paid_amount: order.pay_amount_cents, refunded_amount: order.refund_amount_cents, net_amount: order.pay_amount_cents - order.refund_amount_cents, after_sale_case_count: order.after_sale_cases.length, commission_reward_amount: sum(order.commissions.map((item) => item.final_amount_cents)), created_at: order.created_at, paid_at: order.paid_at, completed_at: order.completed_at })) };
}
export async function getFinanceRewards(query: Query) { const commissions = await prisma.commission.findMany({ where: { created_at: dateWhere(query), order: { community_id: query.community_id, pickup_store_id: query.pickup_store_id } }, include: { order: true }, orderBy: { created_at: 'desc' } }); return commissions.map((item) => ({ reward_id: item.id, leader_user_id: item.leader_user_id, order_id: item.order_id, group_buy_id: item.group_buy_id, reward_amount: item.final_amount_cents, reward_status: item.status, available_at: item.available_at, withdrawal_id: item.withdrawal_id, related_refund_amount: item.order.refund_amount_cents, recalculated_after_refund: item.deduct_amount_cents > 0 || item.order.refund_amount_cents > 0 })); }
export async function getFinanceAfterSales(query: Query) { const cases = await prisma.afterSaleCase.findMany({ where: { created_at: dateWhere(query), order: { community_id: query.community_id, pickup_store_id: query.pickup_store_id } }, orderBy: { created_at: 'desc' } }); return cases.map((item) => ({ after_sale_case_id: item.id, order_id: item.order_id, type: item.type, status: item.status, requested_amount: item.requested_refund_cents ?? 0, approved_amount: item.approved_refund_cents ?? 0, requested_product_refund_cents: item.requested_product_refund_cents ?? 0, requested_delivery_refund_cents: item.requested_delivery_refund_cents ?? 0, approved_product_refund_cents: item.approved_product_refund_cents ?? 0, approved_delivery_refund_cents: item.approved_delivery_refund_cents ?? 0, resolved_amount: item.status === 'resolved' ? (item.approved_refund_cents ?? 0) : 0, refund_id: item.refund_id, linked_inventory_loss_id: item.inventory_loss_id, created_at: item.created_at, resolved_at: item.resolved_at })); }

export function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0] ?? { empty: '' });
  const esc = (value: unknown) => { const text = String(value ?? ''); const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; return `"${safe.replace(/"/g, '""')}"`; };
  return ['\uFEFF' + headers.join(','), ...rows.map((row) => headers.map((key) => esc(row[key])).join(','))].join('\n');
}
