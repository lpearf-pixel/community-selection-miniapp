import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Withdrawal } from './types';

const api = vi.hoisted(() => ({
  approveWithdrawal: vi.fn(async () => undefined),
  rejectWithdrawal: vi.fn(async () => undefined),
  markWithdrawalPaid: vi.fn(async () => undefined),
}));

vi.mock('./api', () => api);

import { executeWithdrawalCommand } from './withdrawal-command-actions';

const item = {
  withdrawal_id: 'withdrawal-1',
  version: 7,
} as Withdrawal;

describe('withdrawal command actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['approve', api.approveWithdrawal],
    ['reject', api.rejectWithdrawal],
  ] as const)('sends the current version and a fresh key for %s', async (
    action,
    command,
  ) => {
    await executeWithdrawalCommand(item, action, '人工审核备注');

    expect(command).toHaveBeenCalledWith(
      'withdrawal-1',
      7,
      expect.stringMatching(`^admin-withdrawal-${action}-`),
      '人工审核备注',
    );
  });

  it('sends the manual reference through mark-paid', async () => {
    await executeWithdrawalCommand(item, 'mark-paid', 'BANK-20260725-1');

    expect(api.markWithdrawalPaid).toHaveBeenCalledWith(
      'withdrawal-1',
      7,
      expect.stringMatching('^admin-withdrawal-mark-paid-'),
      'BANK-20260725-1',
      '人工处理完成',
    );
  });
});
