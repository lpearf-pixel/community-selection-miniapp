import {
  type Order,
  type Prisma,
} from '@prisma/client';
import {
  recordBusinessEvent,
  recordOrderTimeline,
} from '../../services/logging-service.js';

export async function claimOrderPayment(
  tx: Prisma.TransactionClient,
  orderId: string,
  paidAt: Date,
): Promise<{ claimed: boolean; order: Order }> {
  const result = await tx.order.updateMany({
    where: { id: orderId, pay_status: 'unpaid' },
    data: { pay_status: 'paid', paid_at: paidAt },
  });
  if (result.count === 1) {
    return {
      claimed: true,
      order: await tx.order.findUniqueOrThrow({ where: { id: orderId } }),
    };
  }
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('订单不存在');
  return { claimed: false, order };
}

export function setPaidOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
  status: 'paid' | 'grouped',
): Promise<Order> {
  return tx.order.update({
    where: { id: orderId },
    data: { order_status: status },
  });
}

export async function markGroupPaidOrdersGrouped(
  tx: Prisma.TransactionClient,
  groupBuyId: string,
): Promise<number> {
  const result = await tx.order.updateMany({
    where: {
      group_buy_id: groupBuyId,
      pay_status: 'paid',
      order_status: { notIn: ['closed', 'refunded'] },
      refund_status: { notIn: ['success'] },
    },
    data: { order_status: 'grouped' },
  });
  return result.count;
}

export async function recordPaidOrderEffects(
  tx: Prisma.TransactionClient,
  input: {
    beforeOrder: Order;
    paidOrder: Order;
    paymentId: string | null;
    transactionId: string | null;
    groupBuyId: string | null;
    groupStatus: string | null;
  },
): Promise<void> {
  const normalOrder = input.groupBuyId === null;
  await recordBusinessEvent(tx, {
    event_type: normalOrder
      ? 'payment_mark_normal_order_paid'
      : 'payment_mark_order_paid',
    event_source: 'order-payment-service',
    order_id: input.beforeOrder.id,
    group_buy_id: input.groupBuyId,
    payment_id: input.paymentId,
    before_snapshot: input.beforeOrder,
    after_snapshot: input.paidOrder,
    payload: normalOrder
      ? {
          transaction_id: input.transactionId,
          product_id: input.beforeOrder.product_id,
        }
      : {
          transaction_id: input.transactionId,
          group_status: input.groupStatus,
        },
  });
  await recordOrderTimeline(tx, {
    order_id: input.beforeOrder.id,
    event_type: 'payment_mark_order_paid',
    title: '订单已支付',
    from_status: input.beforeOrder.order_status,
    to_status: input.paidOrder.order_status,
    actor_type: 'system',
    payload: { payment_id: input.paymentId },
  });
}
