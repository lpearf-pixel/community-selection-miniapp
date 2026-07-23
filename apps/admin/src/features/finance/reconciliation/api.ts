import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  FinanceAfterSaleRow,
  FinanceOrderRow,
  FinanceOverview,
  FinanceReconciliationData,
  FinanceRewardRow,
} from './types';

export async function loadFinanceReconciliation(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<FinanceReconciliationData> {
  const [overview, orders, rewards, afterSales] = await Promise.all([
    request<FinanceOverview>('/api/admin/finance/reconciliation/overview', {
      signal,
    }),
    request<{ items: FinanceOrderRow[] }>(
      '/api/admin/finance/reconciliation/orders',
      { signal },
    ),
    request<FinanceRewardRow[]>(
      '/api/admin/finance/reconciliation/rewards',
      { signal },
    ),
    request<FinanceAfterSaleRow[]>(
      '/api/admin/finance/reconciliation/after-sales',
      { signal },
    ),
  ]);

  return {
    overview,
    orders: orders.items,
    rewards,
    afterSales,
  };
}
