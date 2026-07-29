import { describe, expect, it } from 'vitest';
import {
  assertAfterSaleRefundDecision,
  deliveryRefundEligibility,
  isAfterSaleType,
} from './after-sale-refund-policy.js';

describe('L53-C after-sale refund policy', () => {
  it.each([
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
  ])('accepts supported issue type %s', (type) => {
    expect(isAfterSaleType(type)).toBe(true);
  });

  it.each([
    'bad_quality',
    'short_weight',
    'missing_item',
    'wrong_item',
    'damaged',
    'not_fresh',
    'other',
  ])('keeps product issue %s ineligible for delivery refund', (type) => {
    expect(deliveryRefundEligibility(type)).toEqual({
      eligible: false,
      reason: 'product_issue',
    });
  });

  it.each([
    'delivery_not_started',
    'delivery_failed',
    'severe_delay',
    'whole_order_unfulfillable',
  ])('allows merchant choice for delivery issue %s', (type) => {
    expect(deliveryRefundEligibility(type)).toEqual({
      eligible: true,
      reason: type,
    });
  });

  it('rejects a delivery refund for a product issue', () => {
    expect(() =>
      assertAfterSaleRefundDecision({
        type: 'bad_quality',
        approved_refund_cents: 600,
        approved_product_refund_cents: 100,
        approved_delivery_refund_cents: 500,
        product_remaining_cents: 2_000,
        delivery_remaining_cents: 500,
      }),
    ).toThrowError('该售后类型不允许退配送费');
  });

  it('accepts an eligible merchant-selected delivery refund within both caps', () => {
    expect(
      assertAfterSaleRefundDecision({
        type: 'delivery_failed',
        approved_refund_cents: 2_500,
        approved_product_refund_cents: 2_000,
        approved_delivery_refund_cents: 500,
        product_remaining_cents: 2_000,
        delivery_remaining_cents: 500,
      }),
    ).toEqual({
      approved_refund_cents: 2_500,
      approved_product_refund_cents: 2_000,
      approved_delivery_refund_cents: 500,
      delivery_refund_eligible: true,
      delivery_refund_selected: true,
    });
  });

  it.each([
    {
      name: 'split mismatch',
      input: [101, 100, 0, 1_000, 500] as const,
      message: '商品退款金额与配送费退款金额之和必须等于总退款金额',
    },
    {
      name: 'product cap',
      input: [1_001, 1_001, 0, 1_000, 500] as const,
      message: '商品退款金额超过商品可退金额',
    },
    {
      name: 'delivery cap',
      input: [501, 0, 501, 1_000, 500] as const,
      message: '配送费退款金额超过配送费可退金额',
    },
  ])('rejects $name', ({ input, message }) => {
    expect(() =>
      assertAfterSaleRefundDecision({
        type: 'delivery_failed',
        approved_refund_cents: input[0],
        approved_product_refund_cents: input[1],
        approved_delivery_refund_cents: input[2],
        product_remaining_cents: input[3],
        delivery_remaining_cents: input[4],
      }),
    ).toThrowError(message);
  });
});
