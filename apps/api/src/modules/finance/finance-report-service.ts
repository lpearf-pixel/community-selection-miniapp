import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

type Query = { from?: string; to?: string; community_id?: string; pickup_store_id?: string; status?: string; page?: number; page_size?: number };

function dateWhere(query: Query): Prisma.DateTimeFilter | undefined {
  const where: Prisma.DateTimeFilter = {};
  if (query.from) where.gte = new Date(query.from);
  if (query.to) where.lte = new Date(query.to);
  return Object.keys(where).length ? where : undefined;
}

function orderWhere(query: Query): Prisma.OrderWhereInput {
  return {
    created_at: dateWhere(query),
    community_id: query.community_id,
    pickup_store_id: query.pickup_store_id,
    order_status: query.status as any
  };
}

function sum(items: Array<number | null | undefined>) { return items.reduce((total, value) => total + (value ?? 0), 0); }

export async function getFinanceOverview(query: Query) {
  const where = orderWhere(query);
  const orders = await prisma.order.findMany({ where, include: { commissions: true, after_sale_cases: true } });
  const orderIds = orders.map((order) => order.id);
  const [afterSaleCases, inventoryLosses, withdrawals] = await Promise.all([
    prisma.afterSaleCase.findMany({ where: { created_at: dateWhere(query), order_id: orderIds.length ? { in: orderIds } : undefined } }),
    prisma.inventoryLoss.findMany({ where: { created_at: dateWhere(query) }, include: { product: true } }),
    prisma.withdrawal.findMany({ where: { created_at: dateWhere(query) } })
  ]);
  const paidAmount = sum(orders.filter((order) => order.pay_status === 'paid').map((order) => order.pay_amount_cents));
  const refundedAmount = sum(orders.map((order) => order.refund_amount_cents));
  return {
    order_count: orders.length,
    paid_order_count: orders.filter((order) => order.pay_status === 'paid').length,
    completed_order_count: orders.filter((order) => order.order_status === 'completed').length,
    refunded_order_count: orders.filter((order) => order.refund_status !== 'none' || order.refund_amount_cents > 0).length,
    gross_sales_amount: sum(orders.map((order) => order.total_amount_cents)),
    paid_amount: paidAmount,
    refunded_amount: refundedAmount,
    net_sales_amount: paidAmount - refundedAmount,
    after_sale_case_count: afterSaleCases.length,
    after_sale_refund_amount: sum(afterSaleCases.map((item) => item.approved_refund_cents ?? item.requested_refund_cents)),
    inventory_loss_count: inventoryLosses.length,
    inventory_loss_estimated_amount: sum(inventoryLosses.map((loss) => loss.quantity * (loss.product.cost_price_cents ?? 0))),
    service_reward_estimated_amount: sum(orders.flatMap((order) => order.commissions.map((item) => item.final_amount_cents))),
    withdrawal_requested_amount: sum(withdrawals.map((item) => item.amount_cents)),
    withdrawal_paid_amount: sum(withdrawals.filter((item) => item.status === 'paid').map((item) => item.amount_cents)),
    tax_review_pending_count: withdrawals.filter((item) => item.tax_status === 'pending' || item.tax_mode === 'pending_review').length
  };
}

export async function getFinanceOrders(query: Query) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
  const where = orderWhere(query);
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: { commissions: true, after_sale_cases: true }, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
  ]);
  return { total, page, page_size: pageSize, items: rows.map((order) => ({
    order_id: order.id, order_no: order.order_no, user_id: order.user_id, group_buy_id: order.group_buy_id, community_id: order.community_id, pickup_store_id: order.pickup_store_id,
    order_status: order.order_status, payment_status: order.pay_status, refund_status: order.refund_status, amount: order.total_amount_cents, paid_amount: order.pay_amount_cents,
    refunded_amount: order.refund_amount_cents, net_amount: order.pay_amount_cents - order.refund_amount_cents, after_sale_case_count: order.after_sale_cases.length,
    commission_reward_amount: sum(order.commissions.map((item) => item.final_amount_cents)), created_at: order.created_at, paid_at: order.paid_at, completed_at: order.completed_at
  })) };
}

export async function getFinanceRewards(query: Query) {
  const commissions = await prisma.commission.findMany({ where: { created_at: dateWhere(query), order: { community_id: query.community_id, pickup_store_id: query.pickup_store_id } }, include: { order: true }, orderBy: { created_at: 'desc' } });
  return commissions.map((item) => ({ reward_id: item.id, leader_user_id: item.leader_user_id, order_id: item.order_id, group_buy_id: item.group_buy_id, reward_amount: item.final_amount_cents, reward_status: item.status, available_at: item.available_at, withdrawal_id: item.withdrawal_id, related_refund_amount: item.order.refund_amount_cents, recalculated_after_refund: item.deduct_amount_cents > 0 || item.order.refund_amount_cents > 0 }));
}

export async function getFinanceAfterSales(query: Query) {
  const cases = await prisma.afterSaleCase.findMany({ where: { created_at: dateWhere(query), order: { community_id: query.community_id, pickup_store_id: query.pickup_store_id } }, orderBy: { created_at: 'desc' } });
  return cases.map((item) => ({ after_sale_case_id: item.id, order_id: item.order_id, type: item.type, status: item.status, requested_amount: item.requested_refund_cents ?? 0, approved_amount: item.approved_refund_cents ?? 0, resolved_amount: item.status === 'resolved' ? (item.approved_refund_cents ?? 0) : 0, refund_id: item.refund_id, linked_inventory_loss_id: item.inventory_loss_id, created_at: item.created_at, resolved_at: item.resolved_at }));
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0] ?? { empty: '' });
  const esc = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return ['\uFEFF' + headers.join(','), ...rows.map((row) => headers.map((key) => esc(row[key])).join(','))].join('\n');
}
