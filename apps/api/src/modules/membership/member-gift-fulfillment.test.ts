import { describe, expect, it } from 'vitest';
import {
  GiftFulfillmentBlockError,
  giftEventForDeliveryStatus,
  isFullRemainingRefund,
  planGiftFulfillmentTransition,
} from './member-gift-fulfillment.js';

describe('member gift fulfillment policy', () => {
  it.each([
    ['pending_dispatch', null],
    ['delivering', 'delivery_started'],
    ['delivered', 'delivery_completed'],
    ['exception', null],
  ] as const)('maps delivery status %s to gift event %s', (status, event) => {
    expect(giftEventForDeliveryStatus(status)).toBe(event);
  });

  it('recognizes only a refund that consumes the full remaining amount', () => {
    expect(isFullRemainingRefund({ payAmountCents: 2_000, refundedCents: 500, requestedCents: 1_500 })).toBe(true);
    expect(isFullRemainingRefund({ payAmountCents: 2_000, refundedCents: 500, requestedCents: 1_499 })).toBe(false);
  });

  it('records delivery start without consuming reserved inventory', () => {
    expect(planGiftFulfillmentTransition({
      event: 'delivery_started',
      claim: { status: 'reserved', fulfillmentStartedAt: null },
    })).toEqual({ action: 'start_fulfillment' });
  });

  it.each(['delivery_completed', 'pickup_verified'] as const)(
    'delivers a reserved gift on %s',
    (event) => {
      expect(planGiftFulfillmentTransition({
        event,
        claim: { status: 'reserved', fulfillmentStartedAt: null },
      })).toEqual({ action: 'deliver' });
    },
  );

  it('releases an unstarted reservation before a full refund', () => {
    expect(planGiftFulfillmentTransition({
      event: 'full_refund',
      claim: { status: 'reserved', fulfillmentStartedAt: null },
    })).toEqual({ action: 'release' });
  });

  it.each([
    { status: 'reserved' as const, fulfillmentStartedAt: new Date('2026-07-31T01:00:00.000Z') },
    { status: 'delivered' as const, fulfillmentStartedAt: null },
  ])('blocks a silent full refund after gift fulfillment has started %#', (claim) => {
    expect(() => planGiftFulfillmentTransition({ event: 'full_refund', claim }))
      .toThrowError(GiftFulfillmentBlockError);
  });

  it.each(['released', 'written_off'] as const)(
    'does not mutate a %s claim during a full refund',
    (status) => {
      expect(planGiftFulfillmentTransition({
        event: 'full_refund',
        claim: { status, fulfillmentStartedAt: null },
      })).toEqual({ action: 'none' });
    },
  );

  it('is a no-op when the order has no gift claim', () => {
    expect(planGiftFulfillmentTransition({ event: 'full_refund', claim: null }))
      .toEqual({ action: 'none' });
  });
});
