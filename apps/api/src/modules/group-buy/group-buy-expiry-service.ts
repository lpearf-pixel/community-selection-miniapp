import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit } from '../audit/audit-service.js';
import { restoreInventoryForRefund } from '../inventory/inventory-order-service.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from '../../services/logging-service.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

type AdminMeta = {
  admin_user_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
};

const refundableOrderStatuses = ['paid', 'grouped', 'preparing', 'ready'] as const;
const refundChannelValues = ['manual_wechat', 'manual_offline', 'manual_other'] as const;

function maskPhone(phone?: string | null) {
  if (!phone) return '';
  return phone.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}

function targetCountOf(groupBuy: { min_quantity: number }) {
  return groupBuy.min_quantity;
}

function manualRefundNo(orderId: string) {
  return `MANUAL-${orderId}`;
}

export async function getGroupBuyPaidProgress(groupBuyId: string, client: DbClient = prisma) {
  const groupBuy = await client.groupBuy.findUnique({ where: { id: groupBuyId } });
  if (!groupBuy) throw new Error('团购不存在');
  const paidOrderWhere: Prisma.OrderWhereInput = {
    group_buy_id: groupBuyId,
    pay_status: 'paid',
    order_status: { notIn: ['closed', 'refunded'] },
    refund_status: { notIn: ['success'] }
  };
  const [quantityResult, paidPeople] = await Promise.all([
    client.order.aggregate({ where: paidOrderWhere, _sum: { quantity: true } }),
    client.order.count({ where: paidOrderWhere })
  ]);
  const paid_quantity = quantityResult._sum.quantity ?? 0;
  const target_count = targetCountOf(groupBuy);
  return {
    groupBuy,
    target_count,
    paid_quantity,
    paid_people: paidPeople,
    remaining_quantity: Math.max(0, target_count - paid_quantity),
    is_expired: groupBuy.end_time.getTime() <= Date.now(),
    is_success: groupBuy.status === 'success'
  };
}

export async function markExpiredGroupBuyFailed(groupBuyId: string, adminMeta: AdminMeta = {}) {
  return prisma.$transaction(async (tx) => {
    const progress = await getGroupBuyPaidProgress(groupBuyId, tx);
    const groupBuy = progress.groupBuy;
    if (groupBuy.status === 'success') throw new Error('已成团团购不能标记失败');
    if (groupBuy.end_time.getTime() > Date.now()) throw new Error('团购未过期，不能标记失败');
    if (progress.paid_quantity >= progress.target_count) {
      await tx.groupBuy.update({ where: { id: groupBuyId }, data: { status: 'success', current_quantity: progress.paid_quantity, current_people: progress.paid_people } });
      await safeRecordBusinessEvent(tx, {
        event_type: 'group_buy_success_refreshed_on_expiry_review',
        event_source: 'group-buy-expiry-service',
        group_buy_id: groupBuyId,
        payload: { paid_quantity: progress.paid_quantity, target_count: progress.target_count, status: 'success' }
      });
      throw new Error('已支付有效份数达到目标，应成团成功而不是失败');
    }
    const finalGroupBuy = groupBuy.status === 'failed'
      ? groupBuy
      : await tx.groupBuy.update({ where: { id: groupBuyId }, data: { status: 'failed', current_quantity: progress.paid_quantity, current_people: progress.paid_people } });
    await safeRecordBusinessEvent(tx, {
      event_type: 'group_buy_expired_manual_failed',
      event_source: 'group-buy-expiry-service',
      group_buy_id: groupBuyId,
      payload: { paid_quantity: progress.paid_quantity, paid_people: progress.paid_people, target_count: progress.target_count, manual: true }
    });
    await recordAdminAudit(tx, {
      admin_user_id: adminMeta.admin_user_id ?? null,
      action: 'group_buy_mark_failed_manual',
      target_type: 'GroupBuy',
      target_id: groupBuyId,
      ip_address: adminMeta.ip_address ?? null,
      user_agent: adminMeta.user_agent ?? null,
      payload: { paid_quantity: progress.paid_quantity, target_count: progress.target_count }
    });
    const paidOrderSummary = await tx.order.aggregate({ where: { group_buy_id: groupBuyId, pay_status: 'paid' }, _count: { _all: true }, _sum: { pay_amount_cents: true, refund_amount_cents: true } });
    return { group_buy: finalGroupBuy, progress: { ...progress, groupBuy: undefined }, paid_order_summary: paidOrderSummary };
  });
}

export async function listExpiredPendingGroupBuys(query: { page?: number; page_size?: number } = {}) {
  const page = Number.isInteger(query.page) && Number(query.page) > 0 ? Number(query.page) : 1;
  const pageSize = Number.isInteger(query.page_size) && Number(query.page_size) > 0 ? Math.min(Number(query.page_size), 100) : 20;
  const where: Prisma.GroupBuyWhereInput = { status: 'pending', end_time: { lt: new Date() } };
  const [total, rows] = await Promise.all([
    prisma.groupBuy.count({ where }),
    prisma.groupBuy.findMany({ where, include: { product: true, community: true }, orderBy: { end_time: 'asc' }, skip: (page - 1) * pageSize, take: pageSize })
  ]);
  const items = await Promise.all(rows.map(async (groupBuy) => {
    const progress = await getGroupBuyPaidProgress(groupBuy.id);
    const [pendingPaidOrderCount, unpaidOrderCount] = await Promise.all([
      prisma.order.count({ where: { group_buy_id: groupBuy.id, pay_status: 'paid', order_status: { notIn: ['closed', 'refunded'] }, refund_status: { notIn: ['success'] } } }),
      prisma.order.count({ where: { group_buy_id: groupBuy.id, pay_status: 'unpaid' } })
    ]);
    return {
      group_buy_id: groupBuy.id,
      product_id: groupBuy.product_id,
      product_name: groupBuy.product.name,
      community_name: groupBuy.community.name,
      status: groupBuy.status,
      target_count: progress.target_count,
      paid_quantity: progress.paid_quantity,
      paid_people: progress.paid_people,
      remaining_quantity: progress.remaining_quantity,
      pending_paid_order_count: pendingPaidOrderCount,
      unpaid_order_count: unpaidOrderCount,
      end_time: groupBuy.end_time.toISOString()
    };
  }));
  return { items, total, page, page_size: pageSize };
}

export async function listGroupBuyManualRefundOrders(groupBuyId: string) {
  const groupBuy = await prisma.groupBuy.findUnique({ where: { id: groupBuyId } });
  if (!groupBuy) throw new Error('团购不存在');
  if (groupBuy.status !== 'failed') throw new Error('只有失败团购可查看人工退款订单');
  const orders = await prisma.order.findMany({
    where: { group_buy_id: groupBuyId, pay_status: 'paid', refund_status: { notIn: ['success'] }, order_status: { notIn: ['refunded', 'closed'] } },
    orderBy: { paid_at: 'asc' }
  });
  return orders.map((order) => ({
    order_id: order.id,
    order_no: order.order_no,
    user_id: order.user_id,
    receiver_name: order.receiver_name,
    receiver_phone_masked: maskPhone(order.receiver_phone),
    quantity: order.quantity,
    pay_amount_cents: order.pay_amount_cents,
    refund_amount_cents: order.refund_amount_cents,
    pay_status: order.pay_status,
    order_status: order.order_status,
    refund_status: order.refund_status,
    created_at: order.created_at.toISOString(),
    paid_at: order.paid_at?.toISOString() ?? null
  }));
}

export async function markGroupBuyOrderManualRefunded(input: {
  order_id: string;
  refund_amount_cents: number;
  refund_channel: typeof refundChannelValues[number];
  refund_transaction_id?: string | null;
  refund_reason?: string | null;
  admin_remark?: string | null;
  admin_meta?: AdminMeta;
}) {
  if (!refundChannelValues.includes(input.refund_channel)) throw new Error('人工退款方式不支持');
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.order_id }, include: { group_buy: true } });
    if (!order) throw new Error('订单不存在');
    if (!order.group_buy_id) throw new Error('非团购订单不能走团购失败人工退款');
    if (order.group_buy?.status !== 'failed') throw new Error('只有失败团购订单可人工标记退款');
    if (order.pay_status !== 'paid') throw new Error('只有已支付订单可标记人工退款');
    if (!refundableOrderStatuses.includes(order.order_status as typeof refundableOrderStatuses[number])) throw new Error('当前订单状态不允许人工标记退款');
    if (order.refund_status === 'success' || order.order_status === 'refunded') throw new Error('订单已全额退款，不能重复标记');
    if (!Number.isInteger(input.refund_amount_cents) || input.refund_amount_cents <= 0) throw new Error('退款金额必须大于 0 分');
    const nextRefundAmount = order.refund_amount_cents + input.refund_amount_cents;
    if (nextRefundAmount > order.pay_amount_cents) throw new Error('退款金额不能超过支付金额');
    const isFullRefund = nextRefundAmount === order.pay_amount_cents;
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { refund_amount_cents: nextRefundAmount, product_refund_amount_cents: nextRefundAmount, delivery_refund_amount_cents: 0, refund_status: isFullRefund ? 'success' : 'processing', order_status: isFullRefund ? 'refunded' : 'refunding' }
    });
    const refund = await tx.refund.upsert({
      where: { out_refund_no: manualRefundNo(order.id) },
      update: {
        refund_amount_cents: nextRefundAmount,
        product_refund_amount_cents: nextRefundAmount,
        delivery_refund_amount_cents: 0,
        refund_id: input.refund_transaction_id ?? undefined,
        reason: input.refund_reason ?? '团购失败人工退款记录',
        status: isFullRefund ? 'success' : 'processing',
        processed_at: new Date(),
        raw_notify: { refund_channel: input.refund_channel, refund_transaction_id: input.refund_transaction_id ?? null, admin_remark: input.admin_remark ?? null, manual: true }
      },
      create: {
        order_id: order.id,
        out_refund_no: manualRefundNo(order.id),
        client_refund_id: `manual-refund-${order.id}`,
        refund_amount_cents: nextRefundAmount,
        product_refund_amount_cents: nextRefundAmount,
        delivery_refund_amount_cents: 0,
        refund_id: input.refund_transaction_id ?? null,
        reason: input.refund_reason ?? '团购失败人工退款记录',
        status: isFullRefund ? 'success' : 'processing',
        processed_at: new Date(),
        raw_notify: { refund_channel: input.refund_channel, refund_transaction_id: input.refund_transaction_id ?? null, admin_remark: input.admin_remark ?? null, manual: true }
      }
    });
    if (isFullRefund) await restoreInventoryForRefund(tx, { refund_id: refund.id, event_type: 'group_failed_refund_restore' });
    await safeRecordOrderTimeline(tx, { order_id: order.id, event_type: 'manual_refund_marked', title: '人工退款已记录', from_status: order.order_status, to_status: updatedOrder.order_status, actor_type: 'admin', actor_user_id: input.admin_meta?.admin_user_id ?? null, payload: { refund_amount_cents: input.refund_amount_cents, refund_channel: input.refund_channel, refund_transaction_id: input.refund_transaction_id ?? null, admin_remark: input.admin_remark ?? null } });
    await safeRecordBusinessEvent(tx, { event_type: 'group_buy_manual_refund_marked', event_source: 'group-buy-expiry-service', order_id: order.id, group_buy_id: order.group_buy_id, refund_id: refund.id, payload: { refund_amount_cents: input.refund_amount_cents, refund_channel: input.refund_channel, refund_transaction_id: input.refund_transaction_id ?? null, manual: true } });
    await recordAdminAudit(tx, { admin_user_id: input.admin_meta?.admin_user_id ?? null, action: 'order_manual_refund_marked', target_type: 'Order', target_id: order.id, ip_address: input.admin_meta?.ip_address ?? null, user_agent: input.admin_meta?.user_agent ?? null, payload: { refund_amount_cents: input.refund_amount_cents, refund_channel: input.refund_channel, refund_transaction_id: input.refund_transaction_id ?? null, admin_remark: input.admin_remark ?? null } });
    return { order: updatedOrder, refund };
  });
}

export async function closeUnpaidGroupBuyOrders(groupBuyId: string, adminMeta: AdminMeta = {}) {
  return prisma.$transaction(async (tx) => {
    const groupBuy = await tx.groupBuy.findUnique({ where: { id: groupBuyId } });
    if (!groupBuy) throw new Error('团购不存在');
    if (groupBuy.status !== 'failed') throw new Error('只有失败团购可关闭未支付订单');
    const result = await tx.order.updateMany({ where: { group_buy_id: groupBuyId, pay_status: 'unpaid' }, data: { order_status: 'closed', pay_status: 'closed' } });
    await safeRecordBusinessEvent(tx, { event_type: 'group_buy_unpaid_orders_closed_manual', event_source: 'group-buy-expiry-service', group_buy_id: groupBuyId, payload: { closed_count: result.count, paid_orders_untouched: true } });
    await recordAdminAudit(tx, { admin_user_id: adminMeta.admin_user_id ?? null, action: 'group_buy_close_unpaid_orders', target_type: 'GroupBuy', target_id: groupBuyId, ip_address: adminMeta.ip_address ?? null, user_agent: adminMeta.user_agent ?? null, payload: { closed_count: result.count, paid_orders_untouched: true } });
    return { closed_count: result.count };
  });
}
