import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { syncCommissionAfterRefund } from './commission-service.js';
import { restoreInventoryForRefund } from '../modules/inventory/inventory-order-service.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from './logging-service.js';

type RefundInput = {
  order_id: string;
  refund_amount_cents: number;
  product_refund_amount_cents?: number;
  delivery_refund_amount_cents?: number;
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

function jsonOrPrismaNull(value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined) {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

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
  existing: { order_id: string; refund_amount_cents: number; product_refund_amount_cents?: number; delivery_refund_amount_cents?: number },
  input: RefundInput
) {
  if (existing.order_id !== input.order_id || existing.refund_amount_cents !== input.refund_amount_cents || (input.product_refund_amount_cents != null && existing.product_refund_amount_cents !== input.product_refund_amount_cents) || (input.delivery_refund_amount_cents != null && existing.delivery_refund_amount_cents !== input.delivery_refund_amount_cents)) {
    throw new Error('退款幂等键已被使用，且请求参数不一致');
  }
}


function ensureNonNegativeInteger(value: unknown, message: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(message);
  return parsed;
}

function allocateRefundSplit(order: { product_amount_cents: number | null; total_amount_cents: number; delivery_fee_cents: number; product_refund_amount_cents: number; delivery_refund_amount_cents: number }, input: RefundInput) {
  const productPaid = order.product_amount_cents ?? order.total_amount_cents;
  const deliveryPaid = order.delivery_fee_cents ?? 0;
  const productRemaining = Math.max(0, productPaid - order.product_refund_amount_cents);
  const deliveryRemaining = Math.max(0, deliveryPaid - order.delivery_refund_amount_cents);
  const hasExplicitSplit = input.product_refund_amount_cents != null || input.delivery_refund_amount_cents != null;
  if (hasExplicitSplit) {
    const productRefund = ensureNonNegativeInteger(input.product_refund_amount_cents ?? 0, '商品退款金额不能小于 0');
    const deliveryRefund = ensureNonNegativeInteger(input.delivery_refund_amount_cents ?? 0, '配送费退款金额不能小于 0');
    if (productRefund + deliveryRefund !== input.refund_amount_cents) throw new Error('商品退款金额与配送费退款金额之和必须等于总退款金额');
    if (productRefund > productRemaining) throw new Error('商品退款金额超过商品可退金额');
    if (deliveryRefund > deliveryRemaining) throw new Error('配送费退款金额超过配送费可退金额');
    return { productRefund, deliveryRefund, productRemaining, deliveryRemaining };
  }
  const productRefund = Math.min(input.refund_amount_cents, productRemaining);
  const deliveryRefund = input.refund_amount_cents - productRefund;
  if (deliveryRefund > deliveryRemaining) throw new Error('退款金额超过订单实付金额');
  return { productRefund, deliveryRefund, productRemaining, deliveryRemaining };
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
  const split = allocateRefundSplit(order, input);
  if (input.refund_amount_cents > getRefundableAmount(order)) {
    await safeRecordBusinessEvent(tx, {
      event_type: 'refund_amount_exceeded',
      event_level: 'warning',
      event_source: 'refund-service',
      order_id: order.id,
      idempotency_key: input.client_refund_id ?? null,
      payload: { refund_amount_cents: input.refund_amount_cents, refundable_amount_cents: getRefundableAmount(order) }
    });
    throw new Error('退款金额超过订单实付金额');
  }
  return { ...order, refundSplit: split };
}

async function getCreditBalance(tx: Prisma.TransactionClient, userId: string) {
  const entries = await tx.consumerCreditLedger.findMany({ where: { user_id: userId } });
  return entries.reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount_cents : -entry.amount_cents), 0);
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
          raw_notify: jsonOrPrismaNull(notifyInfo.raw_notify ?? refund.raw_notify)
        }
      });
    }
    return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
  }
  if (refund.status === 'rejected') throw new Error('已拒绝退款不可成功');

  const refundableAmount = getRefundableAmount(refund.order);
  if (refund.refund_amount_cents > refundableAmount) {
    await safeRecordBusinessEvent(tx, {
      event_type: 'refund_amount_exceeded',
      event_level: 'warning',
      event_source: 'refund-service',
      order_id: refund.order_id,
      refund_id: refund.id,
      payload: { refund_amount_cents: refund.refund_amount_cents, refundable_amount_cents: refundableAmount }
    });
    throw new Error('退款金额超过订单实付金额');
  }

  const nextRefundAmount = refund.order.refund_amount_cents + refund.refund_amount_cents;
  const nextProductRefundAmount = refund.order.product_refund_amount_cents + refund.product_refund_amount_cents;
  const nextDeliveryRefundAmount = refund.order.delivery_refund_amount_cents + refund.delivery_refund_amount_cents;
  const remainingRefundableAmount = refund.order.pay_amount_cents - nextRefundAmount;
  const isFullRefund = nextRefundAmount >= refund.order.pay_amount_cents;
  let stockRestored = refund.stock_restored;
  let stockRestoreSkippedReason: string | null = null;

  if (!isFullRefund) {
    stockRestoreSkippedReason = refund.delivery_refund_amount_cents > 0 && refund.product_refund_amount_cents === 0 ? 'delivery_fee_refund_no_stock_restore' : 'partial_refund_amount_only';
    // 消费额度退款规则：L8 第一版仅在订单全额退款时退回全部平台消费额度；部分退款不自动退回消费额度。
    if (refund.order.credit_amount_cents > 0) {
      await safeRecordBusinessEvent(tx, {
        event_type: 'reward_credit_partial_refund_skipped',
        event_level: 'warning',
        event_source: 'refund-service',
        order_id: refund.order_id,
        refund_id: refund.id,
        user_id: refund.order.user_id,
        payload: { rule: 'full_refund_only', credit_amount_cents: refund.order.credit_amount_cents, refund_amount_cents: refund.refund_amount_cents }
      });
    }
  }

  const updatedRefund = await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: 'success',
      refund_id: notifyInfo.refund_id ?? refund.refund_id,
      stock_restored: stockRestored,
      processed_at: new Date(),
      raw_notify: jsonOrPrismaNull(notifyInfo.raw_notify ?? refund.raw_notify)
    }
  });

  await tx.order.update({
    where: { id: refund.order_id },
    data: {
      refund_amount_cents: nextRefundAmount,
      product_refund_amount_cents: nextProductRefundAmount,
      delivery_refund_amount_cents: nextDeliveryRefundAmount,
      refund_status: 'success',
      order_status: isFullRefund ? 'refunded' : refund.order.order_status
    }
  });

  if (isFullRefund && !stockRestored) {
    const restoreResult = await restoreInventoryForRefund(tx, { refund_id: refund.id });
    stockRestored = restoreResult.applied || restoreResult.idempotent;
    if (!restoreResult.applied && !restoreResult.idempotent && restoreResult.quantity === 0) stockRestoreSkippedReason = 'no_remaining_inventory_to_restore';
    if (restoreResult.applied) {
      await safeRecordBusinessEvent(tx, { event_type: 'refund_stock_restored', event_source: 'refund-service', order_id: refund.order_id, refund_id: refund.id, payload: { stock_quantity: restoreResult.quantity, ledger_id: restoreResult.ledger_id } });
    }
  }

  if (isFullRefund && refund.order.credit_amount_cents > 0 && refund.order.credit_source_type === 'reward_conversion') {
    const existingCreditReturn = await tx.consumerCreditLedger.findFirst({
      where: { user_id: refund.order.user_id, source_type: 'order_refund', source_id: refund.order.id }
    });
    if (!existingCreditReturn) {
      const creditBalance = await getCreditBalance(tx, refund.order.user_id);
      await tx.consumerCreditLedger.create({
        data: {
          user_id: refund.order.user_id,
          source_type: 'order_refund',
          source_id: refund.order.id,
          direction: 'in',
          amount_cents: refund.order.credit_amount_cents,
          balance_after_cents: creditBalance + refund.order.credit_amount_cents,
          usable_scope: 'platform_order',
          remark: '订单退款退回消费额度',
          payload: { original_credit_source_type: refund.order.credit_source_type, original_credit_source_id: refund.order.credit_source_id }
        }
      });
      await safeRecordBusinessEvent(tx, {
        event_type: 'reward_credit_refunded',
        event_source: 'refund-service',
        order_id: refund.order_id,
        refund_id: refund.id,
        user_id: refund.order.user_id,
        payload: { amount_cents: refund.order.credit_amount_cents, credit_source_id: refund.order.credit_source_id }
      });
      await safeRecordOrderTimeline(tx, {
        order_id: refund.order_id,
        event_type: 'reward_credit_refunded',
        title: '订单退款退回消费额度',
        payload: { amount_cents: refund.order.credit_amount_cents, credit_source_id: refund.order.credit_source_id }
      });
    }
  }

  await safeRecordBusinessEvent(tx, {
    event_type: 'refund_success',
    event_source: 'refund-service',
    order_id: refund.order_id,
    refund_id: refund.id,
    before_snapshot: refund,
    after_snapshot: updatedRefund,
    payload: { refund_amount_cents: refund.refund_amount_cents, product_refund_amount_cents: refund.product_refund_amount_cents, delivery_refund_amount_cents: refund.delivery_refund_amount_cents, is_full_refund: isFullRefund }
  });
  await safeRecordOrderTimeline(tx, {
    order_id: refund.order_id,
    event_type: 'refund_success',
    title: isFullRefund ? '订单已全额退款' : '订单已部分退款',
    payload: { refund_id: refund.id, refund_amount_cents: refund.refund_amount_cents }
  });
  await syncCommissionAfterRefund({ order_id: refund.order_id, refund_id: refund.id }, tx);

  await tx.auditLog.create({
    data: {
      action: 'refund_success',
      target_type: 'Refund',
      target_id: refund.id,
      payload: {
        order_id: refund.order_id,
        out_refund_no: refund.out_refund_no,
        refund_amount_cents: refund.refund_amount_cents,
        product_refund_amount_cents: refund.product_refund_amount_cents,
        delivery_refund_amount_cents: refund.delivery_refund_amount_cents,
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
        try {
          assertIdempotencyInputMatches(existing, input);
        } catch (error) {
          await safeRecordBusinessEvent(tx, {
            event_type: 'refund_idempotency_conflict',
            event_level: 'error',
            event_source: 'refund-service',
            order_id: input.order_id,
            refund_id: existing.id,
            idempotency_key: input.client_refund_id,
            payload: { existing_order_id: existing.order_id, existing_refund_amount_cents: existing.refund_amount_cents, requested_refund_amount_cents: input.refund_amount_cents }
          });
          throw error;
        }
        return applyRefundSuccess(tx, existing.id, { raw_notify: { source: 'mock', client_refund_id: input.client_refund_id } });
      }
    }

    const order = await validateRefundRequest(tx, input);
    const outRefundNo = buildOutRefundNo(order, input.client_refund_id);
    const existingOutRefund = await tx.refund.findUnique({ where: { out_refund_no: outRefundNo } });
    if (existingOutRefund) {
      try {
        assertIdempotencyInputMatches(existingOutRefund, input);
      } catch (error) {
        await safeRecordBusinessEvent(tx, {
          event_type: 'refund_idempotency_conflict',
          event_level: 'error',
          event_source: 'refund-service',
          order_id: input.order_id,
          refund_id: existingOutRefund.id,
          idempotency_key: input.client_refund_id,
          payload: { existing_order_id: existingOutRefund.order_id, existing_refund_amount_cents: existingOutRefund.refund_amount_cents, requested_refund_amount_cents: input.refund_amount_cents }
        });
        throw error;
      }
      return applyRefundSuccess(tx, existingOutRefund.id, { raw_notify: { source: 'mock', out_refund_no: outRefundNo } });
    }

    await safeRecordBusinessEvent(tx, {
      event_type: 'refund_requested',
      event_source: 'refund-service',
      order_id: order.id,
      idempotency_key: input.client_refund_id,
      payload: { refund_amount_cents: input.refund_amount_cents, reason: input.reason }
    });

    const refund = await tx.refund.create({
      data: {
        order_id: order.id,
        out_refund_no: outRefundNo,
        client_refund_id: input.client_refund_id,
        refund_amount_cents: input.refund_amount_cents,
        product_refund_amount_cents: order.refundSplit.productRefund,
        delivery_refund_amount_cents: order.refundSplit.deliveryRefund,
        reason: input.reason,
        status: 'pending'
      }
    });

    await tx.order.update({
      where: { id: order.id },
      data: { refund_status: 'pending' }
    });

    const success = await applyRefundSuccess(tx, refund.id, { raw_notify: { source: 'mock', client_refund_id: input.client_refund_id ?? null } });
    await safeRecordBusinessEvent(tx, {
      event_type: 'refund_mock_success',
      event_source: 'refund-service',
      order_id: order.id,
      refund_id: refund.id,
      idempotency_key: input.client_refund_id,
      after_snapshot: success
    });
    return success;
  });
}

export async function markRefundSuccess(refundId: string, notifyInfo: NotifyInfo = {}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => applyRefundSuccess(tx, refundId, notifyInfo));
}
