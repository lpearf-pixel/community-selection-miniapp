import { describe, expect, it } from 'vitest';
import {
  recordPaidWithdrawalReward,
  reserveWithdrawalReward,
  restoreRejectedWithdrawalReward,
  validateReservedWithdrawalReward,
  validateWithdrawalRewardBalance,
} from './withdrawal-reward-ledger-owner.js';

describe('withdrawal reward ledger owner', () => {
  it('fails closed unless the exact reservation exists and no restore exists', async () => {
    const tx = {
      rewardLedger: {
        aggregate: async (args: { where: { event_type: string } }) => ({
          _sum: {
            amount_cents:
              args.where.event_type === 'withdrawal_reserved' ? 3200 : 100,
          },
        }),
      },
    };
    await expect(
      validateReservedWithdrawalReward(tx as never, {
        withdrawal_id: 'withdrawal-1',
        amount_cents: 3200,
      }),
    ).rejects.toThrow('提现预留奖励账本不一致，请人工复核');
  });

  it('validates both each commission net and the leader available total', async () => {
    const tx = {
      rewardLedger: {
        findMany: async (args: {
          where: { commission_id?: string; leader_user_id?: string };
        }) =>
          args.where.commission_id
            ? [{ direction: 'in', amount_cents: 1200 }]
            : [{ direction: 'in', amount_cents: 3200 }],
      },
    };
    await expect(
      validateWithdrawalRewardBalance(tx as never, {
        leader_user_id: 'leader-1',
        commissions: [
          { id: 'commission-a', amount_cents: 1200 },
          { id: 'commission-b', amount_cents: 2000 },
        ],
        amount_cents: 3200,
      }),
    ).rejects.toThrow('奖励账本待人工复核');
  });

  it.each([
    [
      'reserve',
      reserveWithdrawalReward,
      {
        event_type: 'withdrawal_reserved',
        direction: 'out',
        affects_available_balance: true,
        idempotency_key: 'withdrawal-reserved:withdrawal-1',
      },
    ],
    [
      'restore',
      restoreRejectedWithdrawalReward,
      {
        event_type: 'withdrawal_rejected_restore',
        direction: 'in',
        affects_available_balance: true,
        idempotency_key: 'withdrawal-rejected-restore:withdrawal-1',
      },
    ],
    [
      'paid',
      recordPaidWithdrawalReward,
      {
        event_type: 'withdrawal_paid',
        direction: 'out',
        affects_available_balance: false,
        idempotency_key: 'withdrawal-paid:withdrawal-1',
      },
    ],
  ] as const)('%s writes the exact ledger semantics', async (_name, fn, expected) => {
    let created: Record<string, unknown> | undefined;
    const tx = {
      $queryRaw: async () => [{ id: 'leader-1' }],
      rewardLedger: {
        findUnique: async () => null,
        findMany: async () => [
          { direction: 'in', amount_cents: 5000 },
        ],
        create: async (args: { data: Record<string, unknown> }) => {
          created = args.data;
          return { id: 'ledger-1', ...args.data };
        },
      },
    };
    await fn(tx as never, {
      leader_user_id: 'leader-1',
      withdrawal_id: 'withdrawal-1',
      amount_cents: 3200,
    });
    expect(created).toMatchObject({
      withdrawal_id: 'withdrawal-1',
      amount_cents: 3200,
      ...expected,
    });
  });
});
