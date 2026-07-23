import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  CreateStockCheckInput,
  StockCheck,
} from '../shared/types';

export function loadStockChecks(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<StockCheck[]> {
  return request<StockCheck[]>('/api/admin/stock-checks', { signal });
}

export function createStockCheck(
  input: CreateStockCheckInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>('/api/admin/stock-checks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function confirmStockCheck(
  checkId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/stock-checks/${checkId}/confirm`, {
    method: 'POST',
  });
}
