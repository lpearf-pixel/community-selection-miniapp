import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  OperationsAlertRow,
  OperationsCommunityRow,
  OperationsDashboardData,
  OperationsOverview,
  OperationsPickupStoreRow,
  OperationsProductRow,
  OperationsTrendRow,
} from './types';

export async function loadOperationsDashboard(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<OperationsDashboardData> {
  const [overview, trends, products, communities, pickupStores, alerts] =
    await Promise.all([
      request<OperationsOverview>(
        '/api/admin/operations/dashboard/overview',
        { signal },
      ),
      request<OperationsTrendRow[]>(
        '/api/admin/operations/dashboard/trends?days=7',
        { signal },
      ),
      request<OperationsProductRow[]>(
        '/api/admin/operations/dashboard/products',
        { signal },
      ),
      request<OperationsCommunityRow[]>(
        '/api/admin/operations/dashboard/communities',
        { signal },
      ),
      request<OperationsPickupStoreRow[]>(
        '/api/admin/operations/dashboard/pickup-stores',
        { signal },
      ),
      request<OperationsAlertRow[]>(
        '/api/admin/operations/dashboard/alerts',
        { signal },
      ),
    ]);

  return {
    overview,
    trends,
    products,
    communities,
    pickupStores,
    alerts,
  };
}
