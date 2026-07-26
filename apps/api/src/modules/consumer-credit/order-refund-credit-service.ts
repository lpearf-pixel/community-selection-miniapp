import type { Order, Prisma } from '@prisma/client';
import {
  recordBusinessEvent,
  recordOrderTimeline,
} from '../../services/logging-service.js';

export type CreditReturnResult = {
  applied: boolean;
  idempotent: boolean;
  amount_cents: number;
};

export async function returnOrderCreditAfterFullRefund(
  tx: Prisma.TransactionClient,
  input: {
    order: Pick<
      Order,
      | 'id'
      | 'user_id'
      | 'credit_amount_cents'
      | 'credit_source_type'
      | 'credit_source_id'
    >;
    refund_id: string;
    is_full_refund: boolean;
  },
): Promise<CreditReturnResult> {
  const { order } = input;
  if (
    !input.is_full_refund
    || order.credit_amount_cents <= 0
    || order.credit_source_type !== 'reward_conversion'
  ) {
    return { applied: false, idempotent: false, amount_cents: 0 };
  }
  const existing = await tx.consumerCreditLedger.findFirst({
    where: {
      user_id: order.user_id,
      source_type: 'order_refund',
      source_id: order.id,
    },
  });
  if (existing) {
    return {
      applied: false,
      idempotent: true,
      amount_cents: existing.amount_cents,
    };
  }
  const entries = await tx.consumerCreditLedger.findMany({
    where: { user_id: order.user_id },
  });
  const balance = entries.reduce(
    (sum, entry) => sum
      + (entry.direction === 'in'
        ? entry.amount_cents
        : -entry.amount_cents),
    0,
  );
  await tx.consumerCreditLedger.create({
    data: {
      user_id: order.user_id,
      source_type: 'order_refund',
      source_id: order.id,
      direction: 'in',
      amount_cents: order.credit_amount_cents,
      balance_after_cents: balance + order.credit_amount_cents,
      usable_scope: 'platform_order',
      remark: '订单退款退回消费额度',
      payload: {
        original_credit_source_type: order.credit_source_type,
        original_credit_source_id: order.credit_source_id,
      },
    },
  });
  await recordBusinessEvent(tx, {
    event_type: 'reward_credit_refunded',
    event_source: 'order-refund-credit-service',
    order_id: order.id,
    refund_id: input.refund_id,
    user_id: order.user_id,
    payload: {
      amount_cents: order.credit_amount_cents,
      credit_source_id: order.credit_source_id,
    },
  });
  await recordOrderTimeline(tx, {
    order_id: order.id,
    event_type: 'reward_credit_refunded',
    title: '订单退款退回消费额度',
    payload: {
      amount_cents: order.credit_amount_cents,
      credit_source_id: order.credit_source_id,
    },
  });
  return {
    applied: true,
    idempotent: false,
    amount_cents: order.credit_amount_cents,
  };
}
