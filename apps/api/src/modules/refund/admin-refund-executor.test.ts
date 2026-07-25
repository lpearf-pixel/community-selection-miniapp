import { describe, expect, it } from 'vitest';
import { assertAdminRefundEligibility } from './admin-refund-executor.js';

const eligible = {
  status: 'approved',
  resolution_type: 'partial_refund',
  approved_refund_cents: 800,
  approved_product_refund_cents: 700,
  approved_delivery_refund_cents: 100,
  order: {
    version: 3,
    pay_amount_cents: 2_000,
    refund_amount_cents: 200,
    product_amount_cents: 1_800,
    product_refund_amount_cents: 100,
    delivery_fee_cents: 200,
    delivery_refund_amount_cents: 100,
  },
};

describe('Admin refund eligibility', () => {
  it('returns the server-approved split', () => {
    expect(
      assertAdminRefundEligibility(eligible, 3),
    ).toEqual({
      approved_refund_cents: 800,
      approved_product_refund_cents: 700,
      approved_delivery_refund_cents: 100,
    });
  });

  it.each([
    [{ ...eligible, status: 'processing' }, 'ADMIN_REFUND_STATE_CONFLICT'],
    [{ ...eligible, resolution_type: 'reship' }, 'ADMIN_REFUND_STATE_CONFLICT'],
    [{ ...eligible, approved_refund_cents: 0 }, 'ADMIN_REFUND_AMOUNT_CONFLICT'],
    [
      { ...eligible, approved_delivery_refund_cents: 99 },
      'ADMIN_REFUND_AMOUNT_CONFLICT',
    ],
    [
      {
        ...eligible,
        order: { ...eligible.order, version: 4 },
      },
      'ADMIN_ORDER_VERSION_CONFLICT',
    ],
    [
      {
        ...eligible,
        approved_refund_cents: 1_900,
        approved_product_refund_cents: 1_800,
        approved_delivery_refund_cents: 100,
      },
      'ADMIN_REFUND_AMOUNT_CONFLICT',
    ],
  ])('rejects an ineligible snapshot', (snapshot, code) => {
    expect(() =>
      assertAdminRefundEligibility(snapshot, 3),
    ).toThrowError(expect.objectContaining({ code }));
  });
});
