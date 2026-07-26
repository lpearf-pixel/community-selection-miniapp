import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  InventoryOverview,
  StockLedger,
} from '../shared/types';

export type InventoryAdjustmentResult = {
  product_id: string;
  stock_before: number;
  stock_after: number;
  adjust_quantity: number;
  stock_unit: string;
};

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
  expectedStock: number,
  adjustQuantity: number,
  reason: string,
  request: JsonRequester = adminJsonRequest,
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
): Promise<InventoryAdjustmentResult> {
  return request<InventoryAdjustmentResult>(
    `/api/admin/inventory/products/${productId}/adjust`,
    {
      method: 'POST',
      body: JSON.stringify({
        expected_stock: expectedStock,
        adjust_quantity: adjustQuantity,
        reason,
        idempotency_key: createIdempotencyKey(),
      }),
    },
  );
}
