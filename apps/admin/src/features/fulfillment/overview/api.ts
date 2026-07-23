import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type { FulfillmentOverview } from './types';

export function loadFulfillmentOverview(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<FulfillmentOverview> {
  return request<FulfillmentOverview>('/api/admin/fulfillment/overview', {
    signal,
  });
}
