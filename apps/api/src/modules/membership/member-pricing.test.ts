import { describe, expect, it } from 'vitest';
import { MemberPricingError, quoteMemberPrice } from './member-pricing.js';

const activeMembership = { active: true as const, accountId: 'account-1', periodId: 'period-1' };
const inactiveMembership = { active: false as const };

describe('quoteMemberPrice', () => {
  it('uses the regular price for non-members', () => {
    expect(quoteMemberPrice({
      enabled: true, channel: 'regular', listPriceCents: 1_999,
      channelPriceCents: 1_999, costPriceCents: 1_000,
      memberDiscountBps: 9_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 0, minimumMarginCents: 0, ruleVersion: 1,
      membership: inactiveMembership,
    })).toMatchObject({ priceSource: 'regular', unitPriceCents: 1_999, membershipPeriodId: null });
  });

  it('does not apply the member margin floor to a non-member order', () => {
    expect(quoteMemberPrice({
      enabled: true, channel: 'regular', listPriceCents: 1_200,
      channelPriceCents: 1_200, costPriceCents: 1_000,
      memberDiscountBps: 9_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 2_500, minimumMarginCents: 0, ruleVersion: 1,
      membership: inactiveMembership,
    })).toMatchObject({ priceSource: 'regular', unitPriceCents: 1_200, marginFloorApplied: false });
  });

  it('applies the normal member default 9折 with integer-cent floor rounding', () => {
    expect(quoteMemberPrice({
      enabled: true, channel: 'regular', listPriceCents: 1_999,
      channelPriceCents: 1_999, costPriceCents: 1_000,
      memberDiscountBps: 9_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 0, minimumMarginCents: 0, ruleVersion: 3,
      membership: activeMembership,
    })).toEqual(expect.objectContaining({
      priceSource: 'member', unitPriceCents: 1_799,
      membershipPeriodId: 'period-1', ruleVersion: 3,
      marginFloorApplied: false,
    }));
  });

  it('selects the better of group price and 8折 list price without multiplying discounts', () => {
    const common = {
      enabled: true, channel: 'group' as const, listPriceCents: 2_000,
      costPriceCents: 1_000, memberDiscountBps: 9_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 0, minimumMarginCents: 0, ruleVersion: 1,
      membership: activeMembership,
    };
    expect(quoteMemberPrice({ ...common, channelPriceCents: 1_700 })).toMatchObject({
      unitPriceCents: 1_600, priceSource: 'group_member',
    });
    expect(quoteMemberPrice({ ...common, channelPriceCents: 1_500 })).toMatchObject({
      unitPriceCents: 1_500, priceSource: 'group',
    });
  });

  it('uses the stricter of minimum margin cents and margin-rate floor', () => {
    const quote = quoteMemberPrice({
      enabled: true, channel: 'regular', listPriceCents: 2_000,
      channelPriceCents: 2_000, costPriceCents: 1_000,
      memberDiscountBps: 5_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 2_500, minimumMarginCents: 500, ruleVersion: 1,
      membership: activeMembership,
    });
    expect(quote).toMatchObject({
      floorPriceCents: 1_500,
      candidatePriceCents: 1_000,
      unitPriceCents: 1_500,
      marginFloorApplied: true,
    });
  });

  it('rounds the margin-rate floor upward', () => {
    expect(quoteMemberPrice({
      enabled: true, channel: 'regular', listPriceCents: 2_000,
      channelPriceCents: 2_000, costPriceCents: 1_001,
      memberDiscountBps: 5_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 2_500, minimumMarginCents: 0, ruleVersion: 1,
      membership: activeMembership,
    }).floorPriceCents).toBe(1_335);
  });

  it('fails closed if the channel price is already below the required margin floor', () => {
    expect(() => quoteMemberPrice({
      enabled: true, channel: 'group', listPriceCents: 2_000,
      channelPriceCents: 1_200, costPriceCents: 1_000,
      memberDiscountBps: 9_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 2_500, minimumMarginCents: 0, ruleVersion: 1,
      membership: activeMembership,
    })).toThrowError(expect.objectContaining({ code: 'MARGIN_FLOOR_UNSATISFIABLE' }));
  });

  it('does not expose member pricing while the feature is disabled', () => {
    expect(quoteMemberPrice({
      enabled: false, channel: 'regular', listPriceCents: 2_000,
      channelPriceCents: 2_000, costPriceCents: 1_000,
      memberDiscountBps: 5_000, groupMemberDiscountBps: 5_000,
      minimumMarginBps: 0, minimumMarginCents: 0, ruleVersion: 1,
      membership: activeMembership,
    })).toMatchObject({ priceSource: 'regular', unitPriceCents: 2_000, membershipPeriodId: null });
  });

  it('preserves historical group pricing while membership pricing is not attempted', () => {
    expect(quoteMemberPrice({
      enabled: false, channel: 'group', listPriceCents: 1_000,
      channelPriceCents: 1_200, costPriceCents: -1,
      memberDiscountBps: 0, groupMemberDiscountBps: 20_000,
      minimumMarginBps: 10_000, minimumMarginCents: -1, ruleVersion: 1,
      membership: activeMembership,
    })).toMatchObject({ priceSource: 'group', unitPriceCents: 1_200, membershipPeriodId: null });

    expect(quoteMemberPrice({
      enabled: true, channel: 'group', listPriceCents: 1_000,
      channelPriceCents: 1_200, costPriceCents: -1,
      memberDiscountBps: 0, groupMemberDiscountBps: 20_000,
      minimumMarginBps: 10_000, minimumMarginCents: -1, ruleVersion: 1,
      membership: inactiveMembership,
    })).toMatchObject({ priceSource: 'group', unitPriceCents: 1_200, membershipPeriodId: null });
  });

  it.each([
    ['memberDiscountBps', -1], ['memberDiscountBps', 10_001],
    ['groupMemberDiscountBps', 0], ['minimumMarginBps', 10_000],
    ['minimumMarginCents', -1], ['costPriceCents', -1],
  ] as const)('rejects invalid %s', (field, value) => {
    expect(() => quoteMemberPrice({
      enabled: true, channel: 'regular', listPriceCents: 2_000,
      channelPriceCents: 2_000, costPriceCents: 1_000,
      memberDiscountBps: 9_000, groupMemberDiscountBps: 8_000,
      minimumMarginBps: 0, minimumMarginCents: 0, ruleVersion: 1,
      membership: activeMembership, [field]: value,
    })).toThrow(MemberPricingError);
  });
});
