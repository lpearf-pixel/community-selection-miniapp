import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type RefundInput = {
  order_id: string;
  refund_amount_cents: number;
  reason: string;
  client_refund_id?: string;
};

type NotifyInfo = {
  refund_id?: string;
  out_refund_no?: string;
  raw_notify?: Prisma.InputJsonValue;
};

const refundableOrderStatuses = ['paid', 'grouped', 'preparing', 'ready', 'picked', 'delivered', 'completed', 'refunding'];

export function getRefundableAmount(order: { pay_amount_cents: number; refund_amount_cents: number }) {
  return order.pay_amount_cents - order.refund_amount_cents;
}

export function buildOutRefundNo(order: { order_no: string }, clientRefundId?: string) {
  const suffix = clientRefundId ? clientRefundId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : `${Date.now()}`;
  return `RF${order.order_no}${suffix}`;
}

async function applyRefundSuccess(tx: Prisma.TransactionClient, refundId: string, notifyInfo: NotifyInfo = {}) {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    include: { order: { include: { group_buy: true } } }
  });
  if (!refund) throw new Error('退款单不存在');
  if (refund.status === 'success') return refund;
  if (refund.status === 'rejected') throw new Error('已拒绝退款不可成功');

  const refundableAmount = getRefundableAmount(refund.order);
  if (refund.refund_amount_cents > refundableAmount) throw new Error('退款金额超过订单实付金额');

  const nextRefundAmount = refund.order.refund_amount_cents + refund.refund_amount_cents;
  const isFullRefund = nextRefundAmount >= refund.order.pay_amount_cents;
  let stockRestored = refund.stock_restored;

  if (isFullRefund && !stockRestored && refund.order.group_buy) {
    await tx.product.update({
      where: { id: refund.order.group_buy.product_id },
      data: { stock: { increment: refund.order.quantity } }
    });
    stockRestored = true;
  }

  const updatedRefund = await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: 'success',
      stock_restored: stockRestored,
      processed_at: new Date(),
      raw_notify: notifyInfo.raw_notify ?? refund.raw_notify
    }
  });

  await tx.order.update({
    where: { id: refund.order_id },
    data: {
      refund_amount_cents: nextRefundAmount,
      refund_status: 'success',
      order_status: isFullRefund ? 'refunded' : refund.order.order_status
    }
  });

  await tx.auditLog.create({
    data: {
      action: 'refund_success',
      target_type: 'Refund',
      target_id: refund.id,
      payload: {
        order_id: refund.order_id,
        out_refund_no: refund.out_refund_no,
        refund_amount_cents: refund.refund_amount_cents,
        total_refund_amount_cents: nextRefundAmount,
        stock_restored: stockRestored
      }
    }
  });

  return updatedRefund;
}

export async function createMockRefund(input: RefundInput) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (input.client_refund_id) {
      const existing = await tx.refund.findUnique({ where: { client_refund_id: input.client_refund_id } });
      if (existing) return existing.status === 'success' ? existing : applyRefundSuccess(tx, existing.id, { raw_notify: { source: 'mock', client_refund_id: input.client_refund_id } });
    }

    const order = await tx.order.findUnique({ where: { id: input.order_id } });
    if (!order) throw new Error('订单不存在');
    if (order.pay_status !== 'paid' || order.order_status === 'unpaid' || order.order_status === 'closed') throw new Error('未支付订单不能退款');
    if (!refundableOrderStatuses.includes(order.order_status)) throw new Error('当前订单状态不可退款');
    if (order.refund_amount_cents >= order.pay_amount_cents) throw new Error('订单已全额退款');
    if (!Number.isInteger(input.refund_amount_cents) || input.refund_amount_cents <= 0) throw new Error('退款金额必须大于 0');
    if (input.refund_amount_cents > getRefundableAmount(order)) throw new Error('退款金额超过订单实付金额');

    const outRefundNo = buildOutRefundNo(order, input.client_refund_id);
    const existingOutRefund = await tx.refund.findUnique({ where: { out_refund_no: outRefundNo } });
    if (existingOutRefund) return existingOutRefund.status === 'success' ? existingOutRefund : applyRefundSuccess(tx, existingOutRefund.id, { raw_notify: { source: 'mock', out_refund_no: outRefundNo } });

    const refund = await tx.refund.create({
      data: {
        order_id: order.id,
        out_refund_no: outRefundNo,
        client_refund_id: input.client_refund_id,
        refund_amount_cents: input.refund_amount_cents,
        reason: input.reason,
        status: 'pending'
      }
    });

    await tx.order.update({
      where: { id: order.id },
      data: { refund_status: 'pending' }
    });

    return applyRefundSuccess(tx, refund.id, { raw_notify: { source: 'mock', client_refund_id: input.client_refund_id ?? null } });
  });
}

export async function markRefundSuccess(refundId: string, notifyInfo: NotifyInfo = {}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => applyRefundSuccess(tx, refundId, notifyInfo));
}
