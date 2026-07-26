import {
  type Order,
  type Prisma,
  type Refund,
} from '@prisma/client';
import {
  recordBusinessEvent,
  recordOrderTimeline,
} from '../../services/logging-service.js';

const refundableOrderStatuses = [
  'paid',
  'grouped',
  'preparing',
  'ready',
  'picked',
  'delivered',
  'completed',
  'refunding',
];

export class RefundOrderVersionConflictError extends Error {
  constructor() {
    super('订单已被其他操作更新，请刷新后重试');
    this.name = 'RefundOrderVersionConflictError';
  }
}

export type RefundedOrderProjection = {
  order: Order;
  is_full_refund: boolean;
  remaining_refundable_amount_cents: number;
};

export async function lockRefundableOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<Order> {
  await tx.$queryRaw`
    SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
  `;
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('订单不存在');
  return order;
}

export async function projectRefundSuccess(
  tx: Prisma.TransactionClient,
  input: {
    order: Order;
    refund: Refund;
    expected_order_version?: number;
  },
): Promise<RefundedOrderProjection> {
  const { order, refund } = input;
  if (
    order.pay_status !== 'paid'
    || order.order_status === 'unpaid'
    || order.order_status === 'closed'
  ) {
    throw new Error('未支付订单不能退款');
  }
  if (!refundableOrderStatuses.includes(order.order_status)) {
    throw new Error('当前订单状态不可退款');
  }
  if (order.refund_amount_cents >= order.pay_amount_cents) {
    throw new Error('订单已全额退款');
  }
  if (
    input.expected_order_version !== undefined
    && order.version !== input.expected_order_version
  ) {
    throw new RefundOrderVersionConflictError();
  }

  const nextRefund = order.refund_amount_cents + refund.refund_amount_cents;
  const nextProduct = order.product_refund_amount_cents
    + refund.product_refund_amount_cents;
  const nextDelivery = order.delivery_refund_amount_cents
    + refund.delivery_refund_amount_cents;
  const productPaid = order.product_amount_cents ?? order.total_amount_cents;
  if (nextRefund > order.pay_amount_cents) {
    throw new Error('退款金额超过订单实付金额');
  }
  if (nextProduct > productPaid) {
    throw new Error('商品退款金额超过商品可退金额');
  }
  if (nextDelivery > order.delivery_fee_cents) {
    throw new Error('配送费退款金额超过配送费可退金额');
  }
  const isFullRefund = nextRefund >= order.pay_amount_cents;
  const data = {
    refund_amount_cents: nextRefund,
    product_refund_amount_cents: nextProduct,
    delivery_refund_amount_cents: nextDelivery,
    refund_status: 'success' as const,
    order_status: isFullRefund
      ? 'refunded' as const
      : order.order_status,
    ...(input.expected_order_version === undefined
      ? {}
      : { version: { increment: 1 } }),
  };

  let projectedOrder: Order;
  if (input.expected_order_version === undefined) {
    projectedOrder = await tx.order.update({
      where: { id: order.id },
      data,
    });
  } else {
    const changed = await tx.order.updateMany({
      where: {
        id: order.id,
        version: input.expected_order_version,
        refund_amount_cents: order.refund_amount_cents,
        product_refund_amount_cents: order.product_refund_amount_cents,
        delivery_refund_amount_cents: order.delivery_refund_amount_cents,
      },
      data,
    });
    if (changed.count !== 1) throw new RefundOrderVersionConflictError();
    projectedOrder = await tx.order.findUnique({
      where: { id: order.id },
    }) as Order;
  }

  return {
    order: projectedOrder,
    is_full_refund: isFullRefund,
    remaining_refundable_amount_cents: order.pay_amount_cents - nextRefund,
  };
}

export async function recordRefundOrderEffects(
  tx: Prisma.TransactionClient,
  input: {
    before_order: Order;
    projected_order: Order;
    refund: Refund;
    is_full_refund: boolean;
  },
): Promise<void> {
  await recordBusinessEvent(tx, {
    event_type: 'refund_success',
    event_source: 'order-refund-service',
    order_id: input.before_order.id,
    refund_id: input.refund.id,
    before_snapshot: input.before_order,
    after_snapshot: input.projected_order,
    payload: {
      refund_amount_cents: input.refund.refund_amount_cents,
      product_refund_amount_cents:
        input.refund.product_refund_amount_cents,
      delivery_refund_amount_cents:
        input.refund.delivery_refund_amount_cents,
      is_full_refund: input.is_full_refund,
    },
  });
  await recordOrderTimeline(tx, {
    order_id: input.before_order.id,
    event_type: 'refund_success',
    title: input.is_full_refund
      ? '订单已全额退款'
      : '订单已部分退款',
    from_status: input.before_order.order_status,
    to_status: input.projected_order.order_status,
    actor_type: 'system',
    payload: {
      refund_id: input.refund.id,
      refund_amount_cents: input.refund.refund_amount_cents,
    },
  });
}
