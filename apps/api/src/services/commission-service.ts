import type { CommissionStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';

const settlementDelayDays = 7;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function calculateAmount(input: {
  commission_type: 'none' | 'fixed' | 'percent';
  commission_value: number;
  quantity: number;
  base_amount_cents: number;
}) {
  if (input.commission_type === 'none') return 0;
  if (input.commission_type === 'fixed') return input.quantity * input.commission_value;
  return Math.floor((input.base_amount_cents * input.commission_value) / 100);
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
  const estimatedAmount = calculateAmount({
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
  if (!commission || commission.status === 'withdrawn') return commission ?? null;

  const baseAmount = Math.max(0, order.pay_amount_cents - order.refund_amount_cents);
  const isFullRefund = baseAmount <= 0 || order.order_status === 'refunded';
  const recalculated = isFullRefund
    ? 0
    : calculateAmount({
      commission_type: commission.commission_type,
      commission_value: commission.commission_value,
      quantity: order.quantity,
      base_amount_cents: baseAmount
    });
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

  await client.auditLog.create({
    data: {
      action: isFullRefund ? 'commission_cancelled_after_refund' : 'commission_adjusted_after_refund',
      target_type: 'Commission',
      target_id: commission.id,
      payload: {
        order_id: order.id,
        refund_amount_cents: order.refund_amount_cents,
        base_amount_cents: baseAmount,
        final_amount_cents: recalculated,
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
  return client.commission.update({
    where: { id: commission.id },
    data: {
      status: 'pending',
      available_at: addDays(order.completed_at, settlementDelayDays)
    }
  });
}

export async function releaseAvailableCommissions(now = new Date()) {
  const result = await prisma.commission.updateMany({
    where: {
      status: 'pending',
      available_at: { lte: now },
      final_amount_cents: { gt: 0 }
    },
    data: { status: 'available' }
  });
  await prisma.auditLog.create({
    data: {
      action: 'commission_release_available',
      target_type: 'Commission',
      payload: { released_count: result.count, settled_at: now.toISOString() }
    }
  });
  return result;
}
