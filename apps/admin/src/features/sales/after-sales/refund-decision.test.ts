import { describe, expect, it } from 'vitest';
import { buildAfterSaleReviewInput } from './refund-decision';

describe('L53-C merchant after-sale refund decision', () => {
  const base = {
    type: 'bad_quality',
    requested_product_refund_cents: 800,
    order: {
      product_amount_cents: 2_000,
      product_refund_amount_cents: 200,
      delivery_fee_cents: 500,
      delivery_refund_amount_cents: 0,
    },
  };

  it('defaults product issues to product-only approval', () => {
    expect(
      buildAfterSaleReviewInput(base, {
        product_refund_cents: 800,
        refund_delivery_fee: false,
        admin_note: '坏果核验通过',
        responsibility: 'supplier',
      }),
    ).toEqual({
      status: 'approved',
      approved_refund_cents: 800,
      approved_product_refund_cents: 800,
      approved_delivery_refund_cents: 0,
      resolution_type: 'partial_refund',
      responsibility: 'supplier',
      admin_note: '坏果核验通过',
    });
  });

  it('rejects selecting delivery fee for a product issue', () => {
    expect(() =>
      buildAfterSaleReviewInput(base, {
        product_refund_cents: 800,
        refund_delivery_fee: true,
        admin_note: '尝试越权退运费',
        responsibility: 'supplier',
      }),
    ).toThrowError('该售后类型不允许退配送费');
  });

  it('allows an eligible merchant to select the remaining delivery fee', () => {
    expect(
      buildAfterSaleReviewInput(
        { ...base, type: 'delivery_failed' },
        {
          product_refund_cents: 1_800,
          refund_delivery_fee: true,
          admin_note: '配送失败，商家同意退配送费',
          responsibility: 'platform',
        },
      ),
    ).toMatchObject({
      approved_refund_cents: 2_300,
      approved_product_refund_cents: 1_800,
      approved_delivery_refund_cents: 500,
    });
  });

  it('requires an audit reason for approval', () => {
    expect(() =>
      buildAfterSaleReviewInput(base, {
        product_refund_cents: 800,
        refund_delivery_fee: false,
        admin_note: ' ',
        responsibility: 'supplier',
      }),
    ).toThrowError('售后审核原因必填');
  });
});
