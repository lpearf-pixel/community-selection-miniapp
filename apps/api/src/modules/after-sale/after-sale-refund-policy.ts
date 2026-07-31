export const AFTER_SALE_TYPES = [
  'bad_quality',
  'short_weight',
  'missing_item',
  'wrong_item',
  'damaged',
  'not_fresh',
  'other',
  'delivery_not_started',
  'delivery_failed',
  'severe_delay',
  'whole_order_unfulfillable',
] as const;

export type AfterSaleType = (typeof AFTER_SALE_TYPES)[number];

const DELIVERY_REFUND_TYPES = [
  'delivery_not_started',
  'delivery_failed',
  'severe_delay',
  'whole_order_unfulfillable',
] as const;

export function isAfterSaleType(value: unknown): value is AfterSaleType {
  return (
    typeof value === 'string' &&
    AFTER_SALE_TYPES.includes(value as AfterSaleType)
  );
}

export function deliveryRefundEligibility(type: unknown) {
  if (!isAfterSaleType(type)) {
    throw new Error('售后类型不合法');
  }
  const eligible = DELIVERY_REFUND_TYPES.includes(
    type as (typeof DELIVERY_REFUND_TYPES)[number],
  );
  return {
    eligible,
    reason: eligible ? type : 'product_issue',
  };
}

type RefundDecisionInput = {
  type: unknown;
  approved_refund_cents: number;
  approved_product_refund_cents: number;
  approved_delivery_refund_cents: number;
  product_remaining_cents: number;
  delivery_remaining_cents: number;
};

function isNonNegativeSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assertAfterSaleRefundDecision(input: RefundDecisionInput) {
  const values = [
    input.approved_refund_cents,
    input.approved_product_refund_cents,
    input.approved_delivery_refund_cents,
    input.product_remaining_cents,
    input.delivery_remaining_cents,
  ];
  if (!values.every(isNonNegativeSafeInteger) || input.approved_refund_cents <= 0) {
    throw new Error('审核退款金额必须为正整数分');
  }
  if (
    input.approved_product_refund_cents +
      input.approved_delivery_refund_cents !==
    input.approved_refund_cents
  ) {
    throw new Error('商品退款金额与配送费退款金额之和必须等于总退款金额');
  }
  if (
    input.approved_product_refund_cents > input.product_remaining_cents
  ) {
    throw new Error('商品退款金额超过商品可退金额');
  }
  if (
    input.approved_delivery_refund_cents > input.delivery_remaining_cents
  ) {
    throw new Error('配送费退款金额超过配送费可退金额');
  }
  const eligibility = deliveryRefundEligibility(input.type);
  if (input.approved_delivery_refund_cents > 0 && !eligibility.eligible) {
    throw new Error('该售后类型不允许退配送费');
  }
  return {
    approved_refund_cents: input.approved_refund_cents,
    approved_product_refund_cents: input.approved_product_refund_cents,
    approved_delivery_refund_cents: input.approved_delivery_refund_cents,
    delivery_refund_eligible: eligibility.eligible,
    delivery_refund_selected: input.approved_delivery_refund_cents > 0,
  };
}
