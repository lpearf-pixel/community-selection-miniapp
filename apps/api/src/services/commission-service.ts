import type { CommissionStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { safeRaiseOpsAlert, safeRecordBusinessEvent, safeRecordOrderTimeline } from './logging-service.js';

const settlementDelayDays = 7;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function calculateInitialAmount(input: {
  commission_type: 'none' | 'fixed' | 'percent';
  commission_value: number;
  quantity: number;
  base_amount_cents: number;
}) {
  if (input.commission_type === 'none') return 0;
  if (input.commission_type === 'fixed') return input.quantity * input.commission_value;
  return Math.floor((input.base_amount_cents * input.commission_value) / 100);
}

function calculateRefundAdjustedAmount(input: {
  commission_type: 'none' | 'fixed' | 'percent';
  commission_value: number;
  quantity: number;
  base_amount_cents: number;
  original_pay_amount_cents: number;
}) {
  if (input.commission_type === 'none' || input.base_amount_cents <= 0) return 0;
  if (input.commission_type === 'percent') return Math.floor((input.base_amount_cents * input.commission_value) / 100);
  if (input.original_pay_amount_cents <= 0) return 0;
  const initialFixedAmount = input.quantity * input.commission_value;
  return Math.floor((initialFixedAmount * input.base_amount_cents) / input.original_pay_amount_cents);
}

function nextStatusAfterAdjust(current: CommissionStatus, finalAmount: number): CommissionStatus {
  if (finalAmount <= 0) return 'cancelled';
  if (current === 'withdrawn' || current === 'frozen') return current;
  return current;
}

export async function ensureEstimatedCommission(orderId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: { group_buy: { include: { product: true } } }
  });
  if (!order || order.pay_status !== 'paid' || !order.group_buy || !order.leader_user_id) return null;

  const product = order.group_buy.product;
  if (product.commission_type === 'none' || product.commission_value <= 0) return null;
  const baseAmount = Math.max(0, order.pay_amount_cents - order.refund_amount_cents);
  const estimatedAmount = calculateInitialAmount({
    commission_type: product.commission_type,
    commission_value: product.commission_value,
    quantity: order.quantity,
    base_amount_cents: baseAmount
  });
  if (estimatedAmount <= 0) return null;

  const commission = await client.commission.upsert({
    where: { order_id_leader_user_id: { order_id: order.id, leader_user_id: order.leader_user_id } },
    update: {},
    create: {
      leader_user_id: order.leader_user_id,
      order_id: order.id,
      group_buy_id: order.group_buy.id,
      base_amount_cents: baseAmount,
      commission_type: product.commission_type,
      commission_value: product.commission_value,
      estimated_amount_cents: estimatedAmount,
      final_amount_cents: estimatedAmount,
      status: 'estimated'
    }
  });

  await safeRecordBusinessEvent(client, {
    event_type: 'commission_estimated',
    event_source: 'commission-service',
    order_id: order.id,
    group_buy_id: order.group_buy.id,
    commission_id: commission.id,
    leader_user_id: order.leader_user_id,
    after_snapshot: commission,
    payload: { base_amount_cents: baseAmount, final_amount_cents: commission.final_amount_cents }
  });
  await safeRecordOrderTimeline(client, {
    order_id: order.id,
    event_type: 'commission_estimated',
    title: '开团服务奖励已预估',
    payload: { commission_id: commission.id, final_amount_cents: commission.final_amount_cents }
  });

  await client.auditLog.create({
    data: {
      action: 'commission_estimated',
      target_type: 'Commission',
      target_id: commission.id,
      payload: {
        order_id: order.id,
        group_buy_id: order.group_buy.id,
        leader_user_id: order.leader_user_id,
        base_amount_cents: baseAmount,
        final_amount_cents: commission.final_amount_cents
      }
    }
  });
  return commission;
}

export async function syncCommissionAfterRefund(orderId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: { group_buy: { include: { product: true } }, commissions: true }
  });
  if (!order || !order.group_buy || !order.leader_user_id) return null;
  const commission = order.commissions.find((item) => item.leader_user_id === order.leader_user_id);
  if (!commission) return null;
  if (commission.status === 'withdrawn') {
    await safeRecordBusinessEvent(client, {
      event_type: 'commission_refund_after_withdrawn_detected',
      event_level: 'critical',
      event_source: 'commission-service',
      order_id: order.id,
      group_buy_id: order.group_buy.id,
      commission_id: commission.id,
      leader_user_id: commission.leader_user_id,
      before_snapshot: commission,
      payload: { refund_amount_cents: order.refund_amount_cents },
      message: '已提现开团服务奖励发生退款，需要人工处理'
    });
    await safeRaiseOpsAlert(client, {
      alert_type: 'refund_after_withdrawn',
      alert_level: 'critical',
      order_id: order.id,
      group_buy_id: order.group_buy.id,
      commission_id: commission.id,
      leader_user_id: commission.leader_user_id,
      title: '已提现开团服务奖励发生退款',
      message: '订单退款发生在开团服务奖励提现后，请人工核查并处理',
      payload: { refund_amount_cents: order.refund_amount_cents }
    });
    return commission;
  }

  const baseAmount = Math.max(0, order.pay_amount_cents - order.refund_amount_cents);
  const isFullRefund = baseAmount <= 0 || order.order_status === 'refunded';
  const recalculated = isFullRefund
    ? 0
    : calculateRefundAdjustedAmount({
      commission_type: commission.commission_type,
      commission_value: commission.commission_value,
      quantity: order.quantity,
      base_amount_cents: baseAmount,
      original_pay_amount_cents: order.pay_amount_cents
    });
  const previousStatus = commission.status;
  const previousFinalAmount = commission.final_amount_cents;
  const wasAvailable = commission.status === 'available';
  const wasFrozen = commission.status === 'frozen';
  const deductAmount = Math.max(0, commission.estimated_amount_cents - recalculated);
  const status = isFullRefund ? 'cancelled' : nextStatusAfterAdjust(commission.status, recalculated);

  const updated = await client.commission.update({
    where: { id: commission.id },
    data: {
      base_amount_cents: baseAmount,
      deduct_amount_cents: deductAmount,
      final_amount_cents: recalculated,
      status
    }
  });

  await safeRecordBusinessEvent(client, {
    event_type: isFullRefund ? 'commission_cancelled_after_refund' : 'commission_adjusted_after_refund',
    event_level: wasAvailable ? 'warning' : 'info',
    event_source: 'commission-service',
    order_id: order.id,
    group_buy_id: order.group_buy.id,
    commission_id: commission.id,
    leader_user_id: commission.leader_user_id,
    before_snapshot: commission,
    after_snapshot: updated,
    payload: {
      previous_status: previousStatus,
      previous_final_amount_cents: previousFinalAmount,
      new_final_amount_cents: recalculated,
      was_available: wasAvailable,
      was_frozen: wasFrozen,
      is_full_refund: isFullRefund,
      refund_amount_cents: order.refund_amount_cents,
      base_amount_cents: baseAmount
    },
    message: wasAvailable ? '可用开团服务奖励发生退款调整' : null
  });
  await safeRecordOrderTimeline(client, {
    order_id: order.id,
    event_type: isFullRefund ? 'commission_cancelled_after_refund' : 'commission_adjusted_after_refund',
    title: isFullRefund ? '开团服务奖励已取消' : '开团服务奖励已按退款调整',
    payload: { commission_id: commission.id, previous_final_amount_cents: previousFinalAmount, new_final_amount_cents: recalculated }
  });

  await client.auditLog.create({
    data: {
      action: isFullRefund ? 'commission_cancelled_after_refund' : 'commission_adjusted_after_refund',
      target_type: 'Commission',
      target_id: commission.id,
      payload: {
        order_id: order.id,
        previous_status: previousStatus,
        previous_final_amount_cents: previousFinalAmount,
        new_final_amount_cents: recalculated,
        was_available: wasAvailable,
        was_frozen: wasFrozen,
        is_full_refund: isFullRefund,
        refund_amount_cents: order.refund_amount_cents,
        base_amount_cents: baseAmount,
        status
      }
    }
  });
  return updated;
}

export async function markCommissionPendingForCompletedOrder(orderId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const order = await client.order.findUnique({ where: { id: orderId }, include: { commissions: true } });
  if (!order || order.order_status !== 'completed' || !order.completed_at) return null;
  const commission = order.commissions[0];
  if (!commission || commission.status !== 'estimated') return commission ?? null;
  const updated = await client.commission.update({
    where: { id: commission.id },
    data: {
      status: 'pending',
      available_at: addDays(order.completed_at, settlementDelayDays)
    }
  });
  await safeRecordBusinessEvent(client, {
    event_type: 'commission_pending',
    event_source: 'commission-service',
    order_id: order.id,
    commission_id: commission.id,
    before_snapshot: commission,
    after_snapshot: updated
  });
  await safeRecordOrderTimeline(client, {
    order_id: order.id,
    event_type: 'commission_pending',
    title: '开团服务奖励进入待结算',
    from_status: commission.status,
    to_status: updated.status,
    payload: { commission_id: commission.id, available_at: updated.available_at?.toISOString() ?? null }
  });
  return updated;
}

export async function releaseAvailableCommissions(now = new Date()) {
  const pending = await prisma.commission.findMany({
    where: { status: 'pending', available_at: { lte: now }, final_amount_cents: { gt: 0 } }
  });
  const result = await prisma.commission.updateMany({
    where: { id: { in: pending.map((item) => item.id) } },
    data: { status: 'available' }
  });
  for (const commission of pending) {
    const updated = { ...commission, status: 'available' };
    await safeRecordBusinessEvent(prisma, {
      event_type: 'commission_available',
      event_source: 'commission-service',
      order_id: commission.order_id,
      group_buy_id: commission.group_buy_id,
      commission_id: commission.id,
      leader_user_id: commission.leader_user_id,
      before_snapshot: commission,
      after_snapshot: updated,
      payload: { available_at: commission.available_at?.toISOString() ?? null }
    });
    await safeRecordOrderTimeline(prisma, {
      order_id: commission.order_id,
      event_type: 'commission_available',
      title: '开团服务奖励已可用',
      from_status: 'pending',
      to_status: 'available',
      actor_type: 'scheduler',
      payload: { commission_id: commission.id, final_amount_cents: commission.final_amount_cents }
    });
  }
  await prisma.auditLog.create({
    data: {
      action: 'commission_release_available',
      target_type: 'Commission',
      payload: { released_count: result.count, settled_at: now.toISOString() }
    }
  });
  return result;
}
