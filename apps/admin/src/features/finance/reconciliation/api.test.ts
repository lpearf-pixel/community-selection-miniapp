import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import { loadFinanceReconciliation } from './api';

describe('finance reconciliation loader', () => {
  it('loads the four existing endpoints and maps list envelopes', async () => {
    const request = vi.fn(async <T>(path: string): Promise<T> => {
      const value = path.endsWith('/overview')
        ? { paid_amount: 100 }
        : path.endsWith('/orders')
          ? { items: [{ order_id: 'o1' }] }
          : path.endsWith('/rewards')
            ? [{ reward_id: 'r1' }]
            : [{ after_sale_case_id: 'a1' }];
      return value as T;
    }) as JsonRequester;

    const data = await loadFinanceReconciliation(request);

    expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/finance/reconciliation/overview',
      '/api/admin/finance/reconciliation/orders',
      '/api/admin/finance/reconciliation/rewards',
      '/api/admin/finance/reconciliation/after-sales',
    ]);
    expect(data.orders).toEqual([{ order_id: 'o1' }]);
    expect(data.rewards).toEqual([{ reward_id: 'r1' }]);
    expect(data.afterSales).toEqual([{ after_sale_case_id: 'a1' }]);
  });
});
