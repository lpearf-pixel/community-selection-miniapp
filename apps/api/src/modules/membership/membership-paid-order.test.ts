import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_ANNUAL_PRICE_CENTS,
  planPaidMembershipPeriod,
} from './membership-paid-order.js';

describe('paid annual membership lifecycle', () => {
  const paidAt = new Date('2026-07-31T00:00:00.000Z');

  it('charges the fixed 88 yuan annual price', () => {
    expect(MEMBERSHIP_ANNUAL_PRICE_CENTS).toBe(8_800);
  });

  it('starts a first paid year at payment success', () => {
    expect(planPaidMembershipPeriod({ paidAt, currentEndsAt: null })).toEqual({
      startsAt: paidAt,
      endsAt: new Date('2027-07-31T00:00:00.000Z'),
    });
  });

  it('renews an active membership from its current end without overlap', () => {
    const currentEndsAt = new Date('2027-10-01T00:00:00.000Z');
    expect(planPaidMembershipPeriod({ paidAt, currentEndsAt })).toEqual({
      startsAt: currentEndsAt,
      endsAt: new Date('2028-09-30T00:00:00.000Z'),
    });
  });

  it('starts an expired renewal at payment success', () => {
    expect(planPaidMembershipPeriod({
      paidAt,
      currentEndsAt: new Date('2026-07-01T00:00:00.000Z'),
    })).toEqual({
      startsAt: paidAt,
      endsAt: new Date('2027-07-31T00:00:00.000Z'),
    });
  });
});
