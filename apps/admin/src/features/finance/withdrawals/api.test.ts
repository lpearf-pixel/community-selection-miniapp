import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  approveWithdrawal,
  getWithdrawalDetail,
  listWithdrawals,
  markWithdrawalPaid,
  rejectWithdrawal,
} from './api';

describe('withdrawal API boundary', () => {
  it('loads the filtered list with the caller signal', async () => {
    const signal = new AbortController().signal;
    const data = { items: [], total: 0, page: 2, page_size: 20 };
    const request = vi.fn(async <T>(): Promise<T> => data as T) as JsonRequester;

    await expect(
      listWithdrawals(
        {
          status: 'pending',
          keyword: 'leader',
          from: '2026-07-01',
          to: '2026-07-23',
          page: 2,
          page_size: 20,
        },
        request,
        signal,
      ),
    ).resolves.toEqual(data);

    expect(request).toHaveBeenCalledWith(
      '/api/admin/withdrawals?status=pending&keyword=leader&from=2026-07-01&to=2026-07-23&page=2&page_size=20',
      { signal },
    );
  });

  it('sends versioned idempotent manual action commands', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => undefined as T) as JsonRequester;

    await getWithdrawalDetail('w1', request, signal);
    await approveWithdrawal('w1', 3, 'admin-withdrawal-approve-1', '审核通过', request);
    await rejectWithdrawal('w1', 3, 'admin-withdrawal-reject-1', '资料不足', request);
    await markWithdrawalPaid(
      'w1',
      4,
      'admin-withdrawal-paid-1',
      'manual-1',
      '人工处理完成',
      request,
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/admin/withdrawals/w1',
      { signal },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/admin/withdrawals/w1/approve',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_version: 3,
          idempotency_key: 'admin-withdrawal-approve-1',
          admin_remark: '审核通过',
        }),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      '/api/admin/withdrawals/w1/reject',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_version: 3,
          idempotency_key: 'admin-withdrawal-reject-1',
          admin_remark: '资料不足',
        }),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      '/api/admin/withdrawals/w1/mark-paid',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_version: 4,
          idempotency_key: 'admin-withdrawal-paid-1',
          manual_reference: 'manual-1',
          admin_remark: '人工处理完成',
        }),
      },
    );
  });
});
