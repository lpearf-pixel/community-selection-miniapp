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
const autoRestoreStockStatuses = ['paid', 'grouped', 'preparing', 'ready', 'refunding'];
const stockRestorePolicy = 'full_refund_auto_restore_before_fulfillment';

export function getRefundableAmount(order: { pay_amount_cents: number; refund_amount_cents: number }) {
  return order.pay_amount_cents - order.refund_amount_cents;
}

export function buildOutRefundNo(order: { order_no: string }, clientRefundId?: string) {
  const suffix = clientRefundId ? clientRefundId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : `${Date.now()}`;
  return `RF${order.order_no}${suffix}`;
}

function assertRefundNotifyMatches(
  refund: { refund_id: string | null; out_refund_no: string },
  notifyInfo: NotifyInfo
) {
  if (notifyInfo.out_refund_no && notifyInfo.out_refund_no !== refund.out_refund_no) throw new Error('微信退款单号与系统退款单不一致');
  if (notifyInfo.refund_id && refund.refund_id && notifyInfo.refund_id !== refund.refund_id) throw new Error('微信 refund_id 与已有退款记录不一致');
}

function assertIdempotencyInputMatches(
  existing: { order_id: string; refund_amount_cents: number },
  input: RefundInput
) {
  if (existing.order_id !== input.order_id || existing.refund_amount_cents !== input.refund_amount_cents) {
    throw new Error('退款幂等键已被使用，且请求参数不一致');
  }
}

export async function validateRefundRequest(tx: Prisma.TransactionClient, input: RefundInput) {
  if (input.client_refund_id) {
    const existing = await tx.refund.findUnique({ where: { client_refund_id: input.client_refund_id } });
    if (existing) assertIdempotencyInputMatches(existing, input);
  }

  const order = await tx.order.findUnique({ where: { id: input.order_id } });
  if (!order) throw new Error('订单不存在');
  if (order.pay_status !== 'paid' || order.order_status === 'unpaid' || order.order_status === 'closed') throw new Error('未支付订单不能退款');
  if (!refundableOrderStatuses.includes(order.order_status)) throw new Error('当前订单状态不可退款');
  if (order.refund_amount_cents >= order.pay_amount_cents) throw new Error('订单已全额退款');
  if (!Number.isInteger(input.refund_amount_cents) || input.refund_amount_cents <= 0) throw new Error('退款金额必须大于 0');
  if (input.refund_amount_cents > getRefundableAmount(order)) throw new Error('退款金额超过订单实付金额');
  return order;
}

async function applyRefundSuccess(tx: Prisma.TransactionClient, refundId: string, notifyInfo: NotifyInfo = {}) {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    include: { order: { include: { group_buy: true } } }
  });
  if (!refund) throw new Error('退款单不存在');
  assertRefundNotifyMatches(refund, notifyInfo);
  if (notifyInfo.refund_id) {
    const existingRefundId = await tx.refund.findUnique({ where: { refund_id: notifyInfo.refund_id } });
    if (existingRefundId && existingRefundId.id !== refund.id) throw new Error('微信 refund_id 与已有退款记录不一致');
  }

  if (refund.status === 'success') {
    if (notifyInfo.refund_id && !refund.refund_id) {
      return tx.refund.update({
        where: { id: refund.id },
        data: {
          refund_id: notifyInfo.refund_id,
          raw_notify: notifyInfo.raw_notify ?? refund.raw_notify
        }
      });
    }
    return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
  }
  if (refund.status === 'rejected') throw new Error('已拒绝退款不可成功');

  const refundableAmount = getRefundableAmount(refund.order);
  if (refund.refund_amount_cents > refundableAmount) throw new Error('退款金额超过订单实付金额');

  const nextRefundAmount = refund.order.refund_amount_cents + refund.refund_amount_cents;
  const remainingRefundableAmount = refund.order.pay_amount_cents - nextRefundAmount;
  const isFullRefund = nextRefundAmount >= refund.order.pay_amount_cents;
  let stockRestored = refund.stock_restored;
  let stockRestoreSkippedReason: string | null = null;

  // L6 第一版只做金额退款：部分退款不恢复库存；只有全额退款才按订单状态判断是否可自动恢复库存。
  if (isFullRefund && !stockRestored && refund.order.group_buy) {
    if (autoRestoreStockStatuses.includes(refund.order.order_status)) {
      await tx.product.update({
        where: { id: refund.order.group_buy.product_id },
        data: { stock: { increment: refund.order.quantity } }
      });
      stockRestored = true;
    } else {
      stockRestoreSkippedReason = 'order_already_fulfilled';
    }
  } else if (!isFullRefund) {
    stockRestoreSkippedReason = 'partial_refund_amount_only';
  }

  const updatedRefund = await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: 'success',
      refund_id: notifyInfo.refund_id ?? refund.refund_id,
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
        remaining_refundable_amount_cents: remainingRefundableAmount,
        is_full_refund: isFullRefund,
        stock_restored: stockRestored,
        stock_restore_policy: stockRestorePolicy,
        stock_restore_skipped_reason: stockRestoreSkippedReason
      }
    }
  });

  return updatedRefund;
}

export async function createMockRefund(input: RefundInput) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (input.client_refund_id) {
      const existing = await tx.refund.findUnique({ where: { client_refund_id: input.client_refund_id } });
      if (existing) {
        assertIdempotencyInputMatches(existing, input);
        return applyRefundSuccess(tx, existing.id, { raw_notify: { source: 'mock', client_refund_id: input.client_refund_id } });
      }
    }

    const order = await validateRefundRequest(tx, input);
    const outRefundNo = buildOutRefundNo(order, input.client_refund_id);
    const existingOutRefund = await tx.refund.findUnique({ where: { out_refund_no: outRefundNo } });
    if (existingOutRefund) return applyRefundSuccess(tx, existingOutRefund.id, { raw_notify: { source: 'mock', out_refund_no: outRefundNo } });

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
