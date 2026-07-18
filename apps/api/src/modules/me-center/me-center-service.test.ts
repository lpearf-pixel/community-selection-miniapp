import { describe, expect, it } from 'vitest';
import {
  rewardBalanceFromGroups,
  toCenterProfileRole,
  withdrawalStatusText,
} from './me-center-service.js';

describe('L47 me center pure helpers', () => {
  it('maps only leader users to the leader-facing role', () => {
    expect(toCenterProfileRole('leader')).toBe('leader');
    expect(toCenterProfileRole('customer')).toBe('user');
    expect(toCenterProfileRole('admin')).toBe('user');
  });

  it('computes available reward balance from ledger direction groups', () => {
    expect(
      rewardBalanceFromGroups([
        { direction: 'in', _sum: { amount_cents: 1250 } },
        { direction: 'out', _sum: { amount_cents: 300 } },
      ]),
    ).toBe(950);
    expect(rewardBalanceFromGroups([])).toBe(0);
  });

  it('maps manual withdrawal statuses without implying automatic payout', () => {
    expect(withdrawalStatusText('pending')).toBe('待审核');
    expect(withdrawalStatusText('approved')).toBe('已通过，待线下处理');
    expect(withdrawalStatusText('paid')).toBe('已处理');
    expect(withdrawalStatusText('rejected')).toBe('已拒绝');
  });
});
