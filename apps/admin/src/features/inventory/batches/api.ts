import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  BatchLossInput,
  BatchStockLedger,
  ProductBatch,
} from '../shared/types';

export function loadInventoryBatches(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<ProductBatch[]> {
  return request<ProductBatch[]>('/api/admin/inventory/batches', { signal });
}

export function loadBatchLedger(
  batchId: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<BatchStockLedger[]> {
  return request<BatchStockLedger[]>(
    `/api/admin/inventory/batches/${batchId}/ledger`,
    { signal },
  );
}

export function recordBatchLoss(
  batchId: string,
  input: BatchLossInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/inventory/batches/${batchId}/loss`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
