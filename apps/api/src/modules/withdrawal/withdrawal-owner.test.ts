import { describe, expect, it } from 'vitest';
import {
  applyWithdrawalTaxPatch,
  createWithdrawal,
  linkWithdrawalCommissions,
  lockWithdrawal,
  transitionWithdrawal,
} from './withdrawal-owner.js';

describe('withdrawal owner', () => {
  it('locks the withdrawal row before loading its domain snapshot', async () => {
    const events: string[] = [];
    const tx = {
      $queryRaw: async () => {
        events.push('lock');
        return [{ id: 'withdrawal-1' }];
      },
      withdrawal: {
        findUnique: async () => {
          events.push('load');
          return { id: 'withdrawal-1', version: 2 };
        },
      },
    };

    await lockWithdrawal(tx as never, 'withdrawal-1');
    expect(events).toEqual(['lock', 'load']);
  });

  it('creates the complete pending withdrawal snapshot', async () => {
    let data: Record<string, unknown> | undefined;
    const tx = {
      withdrawal: {
        create: async (args: { data: Record<string, unknown> }) => {
          data = args.data;
          return { id: 'withdrawal-1', ...args.data };
        },
      },
    };

    await createWithdrawal(tx as never, {
      leader_user_id: 'leader-1',
      client_request_id: 'request-1',
      amount_cents: 3200,
    });
    expect(data).toEqual({
      leader_user_id: 'leader-1',
      client_request_id: 'request-1',
      amount_cents: 3200,
      status: 'pending',
      taxable_amount_cents: 3200,
      tax_amount_cents: 0,
      payable_amount_cents: 3200,
      tax_mode: 'pending_review',
      tax_status: 'pending',
      invoice_required: false,
      invoice_status: 'not_required',
    });
  });

  it('links every selected commission without skipDuplicates', async () => {
    let args: unknown;
    const tx = {
      withdrawalCommission: {
        createMany: async (input: unknown) => {
          args = input;
          return { count: 2 };
        },
      },
    };
    await linkWithdrawalCommissions(tx as never, {
      withdrawal_id: 'withdrawal-1',
      commissions: [
        { id: 'commission-a', amount_cents: 1200 },
        { id: 'commission-b', amount_cents: 2000 },
      ],
    });
    expect(args).toEqual({
      data: [
        {
          withdrawal_id: 'withdrawal-1',
          commission_id: 'commission-a',
          amount_cents: 1200,
        },
        {
          withdrawal_id: 'withdrawal-1',
          commission_id: 'commission-b',
          amount_cents: 2000,
        },
      ],
    });
  });

  it('applies a tax patch only at the locked version and increments once', async () => {
    let args: unknown;
    const tx = {
      withdrawal: {
        updateMany: async (input: unknown) => {
          args = input;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ id: 'withdrawal-1', version: 4 }),
      },
    };
    const result = await applyWithdrawalTaxPatch(tx as never, {
      withdrawal_id: 'withdrawal-1',
      expected_version: 3,
      reviewed_by_admin_id: 'admin-1',
      patch: {
        tax_mode: 'withheld',
        tax_status: 'completed',
        taxable_amount_cents: 3200,
        tax_amount_cents: 320,
        payable_amount_cents: 2880,
        tax_rate_basis: '10%',
        invoice_required: false,
        invoice_status: 'not_required',
        tax_remark: null,
      },
    });
    expect(args).toMatchObject({
      where: { id: 'withdrawal-1', version: 3 },
      data: {
        tax_mode: 'withheld',
        tax_amount_cents: 320,
        reviewed_by_admin_id: 'admin-1',
        version: { increment: 1 },
      },
    });
    expect(result).toEqual({ id: 'withdrawal-1', version: 4 });
  });

  it('fails closed when a transition does not affect exactly one row', async () => {
    const tx = {
      withdrawal: { updateMany: async () => ({ count: 0 }) },
    };
    await expect(
      transitionWithdrawal(tx as never, {
        withdrawal_id: 'withdrawal-1',
        expected_version: 2,
        action: 'approve',
        admin_user_id: 'admin-1',
        admin_remark: 'approved',
      }),
    ).rejects.toThrow('提现状态已变化，请刷新后重试');
  });
});
