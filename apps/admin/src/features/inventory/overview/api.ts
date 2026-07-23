import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  InventoryOverview,
  StockLedger,
} from '../shared/types';

export function loadInventoryOverview(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<InventoryOverview> {
  return request<InventoryOverview>('/api/admin/inventory/overview', {
    signal,
  });
}

export function loadStockLedger(
  productId: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<StockLedger[]> {
  return request<StockLedger[]>(
    `/api/admin/inventory/ledger?product_id=${productId}`,
    { signal },
  );
}

export function adjustInventory(
  productId: string,
  adjustQuantity: number,
  reason: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/inventory/products/${productId}/adjust`, {
    method: 'POST',
    body: JSON.stringify({
      adjust_quantity: adjustQuantity,
      reason,
    }),
  });
}
