import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type { ExpiryAlert } from '../shared/types';

export async function loadExpiryAlerts(
  days = 7,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<ExpiryAlert[]> {
  const data = await request<{ items: ExpiryAlert[] }>(
    `/api/admin/inventory/expiry-alerts?days=${days}`,
    { signal },
  );
  return data.items;
}
