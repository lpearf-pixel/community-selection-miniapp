import { describe, expect, it } from 'vitest';
import {
  claimCommissionsForWithdrawal,
  lockWithdrawableCommissions,
  markCommissionsWithdrawn,
  releaseCommissionsFromWithdrawal,
} from './withdrawal-commission-owner.js';

const row = (id: string) => ({
  id,
  leader_user_id: 'leader-1',
  order_id: `order-${id}`,
  group_buy_id: 'group-1',
  status: 'available',
  withdrawal_id: null,
  final_amount_cents: 1000,
});

describe('withdrawal commission owner', () => {
  it('locks each commission in lexical order and returns that order', async () => {
    const locked: string[] = [];
    const tx = {
      $queryRaw: async (query: { values?: unknown[] }) => {
        const id = String(query.values?.[0]);
        locked.push(id);
        return [row(id)];
      },
    };

    const result = await lockWithdrawableCommissions(tx as never, {
      leader_user_id: 'leader-1',
      commission_ids: ['commission-b', 'commission-a'],
    });
    expect(locked).toEqual(['commission-a', 'commission-b']);
    expect(result.map((item) => item.id)).toEqual([
      'commission-a',
      'commission-b',
    ]);
  });

  it('rejects a locked row whose state changed', async () => {
    const tx = {
      $queryRaw: async () => [{ ...row('commission-a'), status: 'withdrawing' }],
    };
    await expect(
      lockWithdrawableCommissions(tx as never, {
        leader_user_id: 'leader-1',
        commission_ids: ['commission-a'],
      }),
    ).rejects.toThrow('存在不可提现或已占用的开团服务奖励');
  });

  it.each([
    ['claim', claimCommissionsForWithdrawal, 'available', 'withdrawing'],
    ['release', releaseCommissionsFromWithdrawal, 'withdrawing', 'available'],
    ['paid', markCommissionsWithdrawn, 'withdrawing', 'withdrawn'],
  ] as const)(
    '%s requires the complete commission set to transition',
    async (_name, operation, from, to) => {
      let args: unknown;
      const tx = {
        commission: {
          updateMany: async (input: unknown) => {
            args = input;
            return { count: 1 };
          },
        },
      };
      await operation(tx as never, {
        withdrawal_id: 'withdrawal-1',
        commission_ids: ['commission-a'],
      });
      expect(args).toMatchObject({
        where: {
          id: { in: ['commission-a'] },
          status: from,
        },
        data: { status: to },
      });

      tx.commission.updateMany = async () => ({ count: 0 });
      await expect(
        operation(tx as never, {
          withdrawal_id: 'withdrawal-1',
          commission_ids: ['commission-a'],
        }),
      ).rejects.toThrow('提现关联奖励状态已变化，请人工复核');
    },
  );
});
