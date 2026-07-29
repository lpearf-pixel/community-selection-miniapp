import type { AfterSaleReviewInput } from './types';

const DELIVERY_REFUND_TYPES = new Set([
  'delivery_not_started',
  'delivery_failed',
  'severe_delay',
  'whole_order_unfulfillable',
]);

type ReviewableAfterSale = {
  type: string;
  requested_product_refund_cents?: number | null;
  order?: {
    product_amount_cents?: number | null;
    product_refund_amount_cents?: number;
    delivery_fee_cents?: number;
    delivery_refund_amount_cents?: number;
  } | null;
};

type MerchantDecision = {
  product_refund_cents: number;
  refund_delivery_fee: boolean;
  responsibility: string;
  admin_note: string;
};

export function canRefundDeliveryFee(type: string) {
  return DELIVERY_REFUND_TYPES.has(type);
}

export function buildAfterSaleReviewInput(
  item: ReviewableAfterSale,
  decision: MerchantDecision,
): AfterSaleReviewInput {
  const note = decision.admin_note.trim();
  if (!note) throw new Error('售后审核原因必填');
  if (
    !Number.isSafeInteger(decision.product_refund_cents) ||
    decision.product_refund_cents < 0
  ) {
    throw new Error('商品退款金额必须为非负整数分');
  }
  const order = item.order;
  if (!order) throw new Error('售后订单金额缺失');
  const productRemaining =
    (order.product_amount_cents ?? 0) -
    (order.product_refund_amount_cents ?? 0);
  const deliveryRemaining =
    (order.delivery_fee_cents ?? 0) -
    (order.delivery_refund_amount_cents ?? 0);
  if (decision.product_refund_cents > productRemaining) {
    throw new Error('商品退款金额超过商品可退金额');
  }
  if (decision.refund_delivery_fee && !canRefundDeliveryFee(item.type)) {
    throw new Error('该售后类型不允许退配送费');
  }
  const delivery = decision.refund_delivery_fee
    ? Math.max(0, deliveryRemaining)
    : 0;
  const total = decision.product_refund_cents + delivery;
  if (total <= 0) throw new Error('审核退款金额必须大于 0');
  return {
    status: 'approved',
    approved_refund_cents: total,
    approved_product_refund_cents: decision.product_refund_cents,
    approved_delivery_refund_cents: delivery,
    resolution_type: 'partial_refund',
    responsibility: decision.responsibility,
    admin_note: note,
  };
}
