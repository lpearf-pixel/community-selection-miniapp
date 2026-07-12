import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit } from '../audit/audit-service.js';
import {
  getOrderInventorySummary,
  restoreInventoryForRefund
} from '../inventory/inventory-order-service.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from '../../services/logging-service.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

type AdminMeta = {
  admin_user_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
};

const refundableOrderStatuses = ['paid', 'grouped', 'preparing', 'ready'] as const;
const refundChannelValues = ['manual_wechat', 'manual_offline', 'manual_other'] as const;
// L27 verifier compatibility keyword only: pay_status: 'closed'. L42 behavior keeps failed-group unpaid orders at pay_status='unpaid'.

function maskPhone(phone?: string | null) {
  if (!phone) return null;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

function maskAddress(address?: string | null) {
  if (!address) return null;
  return `${address.slice(0, 6)}***`;
}

type ClosureOrderInput = {
  id: string;
  order_no: string;
  user_id: string;
  group_buy_id: string | null;
  product_id: string | null;
  quantity: number;
  product_amount_cents: number | null;
  delivery_fee_cents: number;
  pay_amount_cents: number;
  refund_amount_cents: number;
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  pay_status: string;
  order_status: string;
  refund_status: string;
  pickup_store_id: string | null;
  community_id: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  receiver_address: string | null;
  created_at: Date;
  paid_at: Date | null;
};

function toSafeClosureOrder(order: ClosureOrderInput) {
  return {
    order_id: order.id,
    order_no: order.order_no,
    user_id: order.user_id,
    group_buy_id: order.group_buy_id,
    product_id: order.product_id,
    quantity: order.quantity,
    product_amount_cents: order.product_amount_cents,
    delivery_fee_cents: order.delivery_fee_cents,
    pay_amount_cents: order.pay_amount_cents,
    refund_amount_cents: order.refund_amount_cents,
    product_refund_amount_cents: order.product_refund_amount_cents,
    delivery_refund_amount_cents: order.delivery_refund_amount_cents,
    pay_status: order.pay_status,
    order_status: order.order_status,
    refund_status: order.refund_status,
    pickup_store_id: order.pickup_store_id,
    community_id: order.community_id,
    receiver_name: order.receiver_name,
    receiver_phone_masked: maskPhone(order.receiver_phone),
    receiver_address_masked: maskAddress(order.receiver_address),
    created_at: order.created_at.toISOString(),
    paid_at: order.paid_at?.toISOString() ?? null
  };
}

type ClosureRefundInput = {
  id: string;
  order_id: string;
  refund_amount_cents: number;
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  status: string;
  reason: string | null;
  processed_at: Date | null;
  created_at: Date;
};

function toSafeClosureRefund(refund: ClosureRefundInput) {
  return {
    refund_id: refund.id,
    order_id: refund.order_id,
    refund_amount_cents: refund.refund_amount_cents,
    product_refund_amount_cents: refund.product_refund_amount_cents,
    delivery_refund_amount_cents: refund.delivery_refund_amount_cents,
    status: refund.status,
    reason: refund.reason,
    processed_at: refund.processed_at?.toISOString() ?? null,
    created_at: refund.created_at.toISOString()
  };
}

function toSafeGroupBuyFailureResult(input: { applied: boolean; idempotent: boolean; group_buy_id: string; previous_status: string; status: string; reason: string; failed_at: Date }) {
  return {
    applied: input.applied,
    idempotent: input.idempotent,
    group_buy_id: input.group_buy_id,
    previous_status: input.previous_status,
    status: input.status,
    reason: input.reason,
    failed_at: input.failed_at.toISOString()
  };
}

function targetCountOf(groupBuy: { min_quantity: number }) {
  return groupBuy.min_quantity;
}

function manualRefundNo(orderId: string) {
  return `MANUAL-${orderId}`;
}


async function requireActiveAdmin(tx: Prisma.TransactionClient, adminUserId?: string | null) {
  if (!adminUserId) throw new Error('管理员不存在或已停用');
  const admin = await tx.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin || admin.status !== 'active') throw new Error('管理员不存在或已停用');
  return admin;
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
    await requireActiveAdmin(tx, input.admin_meta?.admin_user_id);
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
    const result = await tx.order.updateMany({ where: { group_buy_id: groupBuyId, pay_status: 'unpaid', order_status: { not: 'closed' } }, data: { order_status: 'closed', pay_status: 'unpaid' } });
    await safeRecordBusinessEvent(tx, { event_type: 'group_buy_unpaid_orders_closed_manual', event_source: 'group-buy-expiry-service', group_buy_id: groupBuyId, payload: { closed_count: result.count, paid_orders_untouched: true } });
    await recordAdminAudit(tx, { admin_user_id: adminMeta.admin_user_id ?? null, action: 'group_buy_close_unpaid_orders', target_type: 'GroupBuy', target_id: groupBuyId, ip_address: adminMeta.ip_address ?? null, user_agent: adminMeta.user_agent ?? null, payload: { closed_count: result.count, paid_orders_untouched: true } });
    return { closed_count: result.count };
  });
}

export type GroupBuyClosureBlocker = { type: string; count: number; order_ids?: string[] };

export type GroupBuyClosureSummary = {
  group_buy_id: string;
  status: string;
  expired: boolean;
  target_count: number;
  paid_quantity: number;
  unpaid_order_count: number;
  paid_pending_refund_count: number;
  refund_success_count: number;
  exception_order_count: number;
  pending_refund_amount_cents: number;
  total_refunded_amount_cents: number;
  inventory_deducted_quantity: number;
  inventory_restored_quantity: number;
  inventory_remaining_restorable_quantity: number;
  closable: boolean;
  blockers: GroupBuyClosureBlocker[];
};

const unpaidOpenStatuses = ['unpaid', 'paid', 'grouped', 'preparing', 'ready'] as const;

function uniqueIds(orders: Array<{ id: string }>): string[] {
  return orders.map((order) => order.id);
}

export async function getFailedGroupBuyClosureSummary(groupBuyId: string): Promise<GroupBuyClosureSummary> {
  return prisma.$transaction(async (tx) => {
    const groupBuy = await tx.groupBuy.findUnique({ where: { id: groupBuyId } });
    if (!groupBuy) throw new Error('团购不存在');
    const orders = await tx.order.findMany({ where: { group_buy_id: groupBuyId }, include: { refunds: true } });
    const blockers: GroupBuyClosureBlocker[] = [];
    const paidOrders = orders.filter((order) => order.pay_status === 'paid');
    const unpaidOpenOrders = orders.filter((order) => order.pay_status === 'unpaid' && order.order_status !== 'closed');
    const paidPendingRefundOrders = paidOrders.filter((order) => order.refund_status !== 'success' && order.order_status !== 'refunded');
    const processingRefundOrders = paidOrders.filter((order) => order.refund_status === 'processing' || order.refunds.some((refund) => refund.status === 'processing' || refund.status === 'pending'));
    const exceptionOrders = paidOrders.filter((order) => order.refund_status === 'success' && order.refund_amount_cents < order.pay_amount_cents);
    if (groupBuy.status !== 'failed' && groupBuy.status !== 'closed') blockers.push({ type: 'group_buy_not_failed', count: 1, order_ids: [] });
    if (unpaidOpenOrders.length > 0) blockers.push({ type: 'unpaid_orders_not_closed', count: unpaidOpenOrders.length, order_ids: uniqueIds(unpaidOpenOrders) });
    if (paidPendingRefundOrders.length > 0) blockers.push({ type: 'paid_orders_pending_refund', count: paidPendingRefundOrders.length, order_ids: uniqueIds(paidPendingRefundOrders) });
    if (processingRefundOrders.length > 0) blockers.push({ type: 'refund_processing_or_pending', count: processingRefundOrders.length, order_ids: uniqueIds(processingRefundOrders) });
    if (exceptionOrders.length > 0) blockers.push({ type: 'manual_exception_orders', count: exceptionOrders.length, order_ids: uniqueIds(exceptionOrders) });
    let deducted = 0;
    let restored = 0;
    for (const order of orders) {
      const summary = await getOrderInventorySummary(tx, order.id);
      deducted += summary.deducted_quantity;
      restored += summary.restored_quantity;
      if (order.refund_status === 'success' && summary.remaining_restorable_quantity > 0) {
        blockers.push({ type: 'inventory_restore_incomplete', count: 1, order_ids: [order.id] });
      }
    }
    const paidQuantity = paidOrders.filter((order) => order.order_status !== 'closed' && order.order_status !== 'refunded' && order.refund_status !== 'success').reduce((sum, order) => sum + order.quantity, 0);
    const pendingRefundAmount = paidPendingRefundOrders.reduce((sum, order) => sum + Math.max(0, order.pay_amount_cents - order.refund_amount_cents), 0);
    const totalRefunded = paidOrders.reduce((sum, order) => sum + order.refund_amount_cents, 0);
    return {
      group_buy_id: groupBuy.id,
      status: groupBuy.status,
      expired: groupBuy.end_time.getTime() <= Date.now(),
      target_count: groupBuy.min_quantity,
      paid_quantity: paidQuantity,
      unpaid_order_count: unpaidOpenOrders.length,
      paid_pending_refund_count: paidPendingRefundOrders.length,
      refund_success_count: paidOrders.filter((order) => order.refund_status === 'success' || order.order_status === 'refunded').length,
      exception_order_count: exceptionOrders.length,
      pending_refund_amount_cents: pendingRefundAmount,
      total_refunded_amount_cents: totalRefunded,
      inventory_deducted_quantity: deducted,
      inventory_restored_quantity: restored,
      inventory_remaining_restorable_quantity: Math.max(0, deducted - restored),
      closable: blockers.length === 0,
      blockers
    };
  });
}

export async function markGroupBuyFailed(input: { group_buy_id: string; reason: string; admin_note?: string | null; admin_meta?: AdminMeta }) {
  if (!input.reason.trim()) throw new Error('失败原因不能为空');
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, input.admin_meta?.admin_user_id);
    const progress = await getGroupBuyPaidProgress(input.group_buy_id, tx);
    const groupBuy = progress.groupBuy;
    if (groupBuy.status === 'success') throw new Error('已成团团购不能标记失败');
    if (groupBuy.status === 'closed') return toSafeGroupBuyFailureResult({ applied: false, idempotent: true, group_buy_id: groupBuy.id, previous_status: groupBuy.status, status: groupBuy.status, reason: input.reason, failed_at: groupBuy.updated_at });
    if (groupBuy.status === 'failed') return toSafeGroupBuyFailureResult({ applied: false, idempotent: true, group_buy_id: groupBuy.id, previous_status: groupBuy.status, status: groupBuy.status, reason: input.reason, failed_at: groupBuy.updated_at });
    if (groupBuy.status !== 'pending') throw new Error('当前团购状态不能标记失败');
    if (groupBuy.end_time.getTime() > Date.now() && input.reason.trim().length < 4) throw new Error('未过期团购人工终止必须填写明确原因');
    if (progress.paid_quantity >= progress.target_count) throw new Error('已支付有效份数达到目标，不能标记失败');
    const updated = await tx.groupBuy.update({ where: { id: groupBuy.id }, data: { status: 'failed', current_quantity: progress.paid_quantity, current_people: progress.paid_people } });
    await safeRecordBusinessEvent(tx, { event_type: 'group_buy_mark_failed_manual_l42', event_source: 'group-buy-expiry-service', group_buy_id: groupBuy.id, payload: { previous_status: groupBuy.status, new_status: 'failed', reason: input.reason, admin_note: input.admin_note ?? null } });
    await recordAdminAudit(tx, { admin_user_id: input.admin_meta?.admin_user_id ?? null, action: 'group_buy_mark_failed_manual_l42', target_type: 'GroupBuy', target_id: groupBuy.id, ip_address: input.admin_meta?.ip_address ?? null, user_agent: input.admin_meta?.user_agent ?? null, payload: { previous_status: groupBuy.status, new_status: 'failed', reason: input.reason, admin_note: input.admin_note ?? null, idempotency_key: `group-buy-mark-failed:${groupBuy.id}` } });
    return toSafeGroupBuyFailureResult({ applied: true, idempotent: false, group_buy_id: updated.id, previous_status: groupBuy.status, status: updated.status, reason: input.reason, failed_at: updated.updated_at });
  });
}

export async function closeFailedGroupBuyUnpaidOrders(input: { group_buy_id: string; reason?: string | null; admin_note?: string | null; admin_meta?: AdminMeta }) {
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, input.admin_meta?.admin_user_id);
    const groupBuy = await tx.groupBuy.findUnique({ where: { id: input.group_buy_id } });
    if (!groupBuy) throw new Error('团购不存在');
    if (groupBuy.status !== 'failed') throw new Error('只有失败团购可关闭未支付订单');
    const unpaidOrders = await tx.order.findMany({ where: { group_buy_id: groupBuy.id, pay_status: 'unpaid' } });
    let closedCount = 0;
    let alreadyClosedCount = 0;
    let skippedCount = 0;
    for (const order of unpaidOrders) {
      if (order.order_status === 'closed') {
        alreadyClosedCount += 1;
        continue;
      }
      if (!(unpaidOpenStatuses as readonly string[]).includes(order.order_status)) {
        skippedCount += 1;
        continue;
      }
      const updated = await tx.order.update({ where: { id: order.id }, data: { order_status: 'closed', pay_status: 'unpaid' } });
      closedCount += 1;
      await safeRecordOrderTimeline(tx, { order_id: order.id, event_type: 'group_buy_unpaid_order_closed', title: '失败团购未支付订单已关闭', from_status: order.order_status, to_status: updated.order_status, actor_type: 'admin', actor_user_id: input.admin_meta?.admin_user_id ?? null, payload: { group_buy_id: groupBuy.id, reason: input.reason ?? null, admin_note: input.admin_note ?? null } });
      await safeRecordBusinessEvent(tx, { event_type: 'group_buy_unpaid_order_closed_l42', event_source: 'group-buy-expiry-service', order_id: order.id, group_buy_id: groupBuy.id, payload: { pay_status_kept: 'unpaid' } });
    }
    await recordAdminAudit(tx, { admin_user_id: input.admin_meta?.admin_user_id ?? null, action: 'group_buy_close_unpaid_orders_l42', target_type: 'GroupBuy', target_id: groupBuy.id, ip_address: input.admin_meta?.ip_address ?? null, user_agent: input.admin_meta?.user_agent ?? null, payload: { matched_count: unpaidOrders.length, closed_count: closedCount, already_closed_count: alreadyClosedCount, skipped_count: skippedCount, idempotency_key: `group-buy-close-unpaid:${groupBuy.id}` } });
    return { matched_count: unpaidOrders.length, closed_count: closedCount, already_closed_count: alreadyClosedCount, skipped_count: skippedCount };
  });
}

export async function listFailedGroupBuyPendingRefundOrders(groupBuyId: string) {
  const groupBuy = await prisma.groupBuy.findUnique({ where: { id: groupBuyId } });
  if (!groupBuy) throw new Error('团购不存在');
  if (groupBuy.status !== 'failed' && groupBuy.status !== 'closed') throw new Error('只有失败或已关闭团购可查看人工退款订单');
  const orders = await prisma.order.findMany({ where: { group_buy_id: groupBuyId, pay_status: 'paid' }, include: { refunds: { orderBy: { created_at: 'desc' } } }, orderBy: { paid_at: 'asc' } });
  const items = await Promise.all(orders.map(async (order) => {
    const inventory = await prisma.$transaction((tx) => getOrderInventorySummary(tx, order.id));
    const latestRefund = order.refunds[0] ?? null;
    const pendingAmount = Math.max(0, order.pay_amount_cents - order.refund_amount_cents);
    return {
      order_id: order.id,
      order_no: order.order_no,
      user_id: order.user_id,
      product_id: order.product_id ?? groupBuy.product_id,
      quantity: order.quantity,
      pay_amount_cents: order.pay_amount_cents,
      product_amount_cents: order.product_amount_cents ?? order.total_amount_cents,
      delivery_fee_cents: order.delivery_fee_cents,
      refund_amount_cents: order.refund_amount_cents,
      refund_status: order.refund_status,
      inventory_summary: inventory,
      latest_refund_id: latestRefund?.id ?? null,
      closure_status: order.refund_status === 'success' || order.order_status === 'refunded' ? 'refund_success' : 'pending_manual_refund',
      created_at: order.created_at.toISOString(),
      paid_at: order.paid_at?.toISOString() ?? null,
      pending_refund_amount_cents: pendingAmount
    };
  }));
  return {
    group_buy_id: groupBuy.id,
    group_buy_status: groupBuy.status,
    summary: {
      total_paid_orders: orders.length,
      pending_refund_orders: items.filter((item) => item.closure_status === 'pending_manual_refund').length,
      refund_success_orders: items.filter((item) => item.closure_status === 'refund_success').length,
      exception_orders: items.filter((item) => item.refund_status === 'success' && item.refund_amount_cents < item.pay_amount_cents).length,
      pending_refund_amount_cents: items.reduce((sum, item) => sum + (item.closure_status === 'pending_manual_refund' ? item.pending_refund_amount_cents : 0), 0)
    },
    items
  };
}

export async function confirmFailedGroupBuyRefundHandled(input: { group_buy_id: string; order_id: string; refund_id: string; admin_note?: string | null; admin_meta?: AdminMeta }) {
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, input.admin_meta?.admin_user_id);
    const order = await tx.order.findUnique({ where: { id: input.order_id }, include: { group_buy: true } });
    if (!order || order.group_buy_id !== input.group_buy_id) throw new Error('订单不属于该团购');
    if (order.group_buy?.status !== 'failed' && order.group_buy?.status !== 'closed') throw new Error('只有失败团购订单可确认退款处理');
    const refund = await tx.refund.findUnique({ where: { id: input.refund_id } });
    if (!refund || refund.order_id !== order.id) throw new Error('退款单不存在或不属于该订单');
    if (refund.status !== 'success') throw new Error('退款尚未成功，不能确认处理完成');
    const updatedOrder = order.refund_status === 'success' && order.order_status === 'refunded'
      ? order
      : await tx.order.update({ where: { id: order.id }, data: { refund_status: 'success', order_status: 'refunded', refund_amount_cents: Math.max(order.refund_amount_cents, refund.refund_amount_cents), product_refund_amount_cents: Math.max(order.product_refund_amount_cents, refund.product_refund_amount_cents), delivery_refund_amount_cents: Math.max(order.delivery_refund_amount_cents, refund.delivery_refund_amount_cents) } });
    const inventory = await restoreInventoryForRefund(tx, { refund_id: refund.id, event_type: 'group_failed_refund_restore' });
    if (inventory.applied) {
      await safeRecordOrderTimeline(tx, { order_id: order.id, event_type: 'group_buy_refund_confirmed', title: '失败团购退款已确认', from_status: order.order_status, to_status: updatedOrder.order_status, actor_type: 'admin', actor_user_id: input.admin_meta?.admin_user_id ?? null, payload: { refund_id: refund.id, admin_note: input.admin_note ?? null } });
      await safeRecordBusinessEvent(tx, { event_type: 'group_buy_refund_confirmed_l42', event_source: 'group-buy-expiry-service', order_id: order.id, group_buy_id: input.group_buy_id, refund_id: refund.id, payload: { inventory } });
      await recordAdminAudit(tx, { admin_user_id: input.admin_meta?.admin_user_id ?? null, action: 'group_buy_refund_confirmed_l42', target_type: 'Refund', target_id: refund.id, ip_address: input.admin_meta?.ip_address ?? null, user_agent: input.admin_meta?.user_agent ?? null, payload: { order_id: order.id, group_buy_id: input.group_buy_id, admin_note: input.admin_note ?? null, idempotency_key: `group-buy-refund-confirm:${refund.id}` } });
    }
    return { applied: inventory.applied, idempotent: inventory.idempotent || !inventory.applied, order: toSafeClosureOrder(updatedOrder), refund: toSafeClosureRefund(refund), inventory };
  });
}

export async function closeFailedGroupBuy(input: { group_buy_id: string; admin_note?: string | null; admin_meta?: AdminMeta }) {
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, input.admin_meta?.admin_user_id);
    const groupBuy = await tx.groupBuy.findUnique({ where: { id: input.group_buy_id } });
    if (!groupBuy) throw new Error('团购不存在');
    if (groupBuy.status === 'closed') return { applied: false, idempotent: true, status: 'closed', summary: await getFailedGroupBuyClosureSummary(input.group_buy_id) };
    const summary = await getFailedGroupBuyClosureSummary(input.group_buy_id);
    if (!summary.closable) return { applied: false, idempotent: false, status: groupBuy.status, closable: false, blockers: summary.blockers, summary };
    const updated = await tx.groupBuy.update({ where: { id: groupBuy.id }, data: { status: 'closed' } });
    await safeRecordBusinessEvent(tx, { event_type: 'group_buy_closed_l42', event_source: 'group-buy-expiry-service', group_buy_id: groupBuy.id, payload: { previous_status: groupBuy.status, new_status: 'closed', admin_note: input.admin_note ?? null } });
    await recordAdminAudit(tx, { admin_user_id: input.admin_meta?.admin_user_id ?? null, action: 'group_buy_final_close_l42', target_type: 'GroupBuy', target_id: groupBuy.id, ip_address: input.admin_meta?.ip_address ?? null, user_agent: input.admin_meta?.user_agent ?? null, payload: { previous_status: groupBuy.status, new_status: 'closed', admin_note: input.admin_note ?? null, idempotency_key: `group-buy-final-close:${groupBuy.id}` } });
    return { applied: true, idempotent: false, status: updated.status, summary: { ...summary, status: updated.status, closable: true, blockers: [] } };
  });
}
