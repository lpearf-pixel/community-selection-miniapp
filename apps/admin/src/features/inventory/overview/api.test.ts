import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  adjustInventory,
  loadInventoryOverview,
  loadStockLedger,
} from './api';

describe('inventory overview API boundary', () => {
  it('loads inventory overview with the caller signal', async () => {
    const signal = new AbortController().signal;
    const data = {
      low_stock_count: 0,
      out_of_stock_count: 0,
      total_sku_count: 0,
      items: [],
    };
    const request = vi.fn(async <T>(): Promise<T> => data as T) as JsonRequester;

    await expect(loadInventoryOverview(request, signal)).resolves.toEqual(data);

    expect(request).toHaveBeenCalledWith('/api/admin/inventory/overview', {
      signal,
    });
  });

  it('sends the expected stock and a fresh idempotency key for each adjustment', async () => {
    const signal = new AbortController().signal;
    const result = {
      product_id: 'p1',
      stock_before: 10,
      stock_after: 8,
      adjust_quantity: -2,
      stock_unit: '份',
    };
    const request = vi.fn(async <T>(): Promise<T> => result as T) as JsonRequester;
    const createIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce('inventory-adjust-client-0001')
      .mockReturnValueOnce('inventory-adjust-client-0002');

    await loadStockLedger('p1', request, signal);
    await expect(
      adjustInventory(
        'p1',
        10,
        -2,
        '盘亏',
        request,
        createIdempotencyKey,
      ),
    ).resolves.toEqual(result);
    await adjustInventory(
      'p1',
      8,
      1,
      '补录',
      request,
      createIdempotencyKey,
    );

    expect(request).toHaveBeenCalledWith(
      '/api/admin/inventory/ledger?product_id=p1',
      { signal },
    );
    expect(request).toHaveBeenCalledWith(
      '/api/admin/inventory/products/p1/adjust',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_stock: 10,
          adjust_quantity: -2,
          reason: '盘亏',
          idempotency_key: 'inventory-adjust-client-0001',
        }),
      },
    );
    expect(request).toHaveBeenLastCalledWith(
      '/api/admin/inventory/products/p1/adjust',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_stock: 8,
          adjust_quantity: 1,
          reason: '补录',
          idempotency_key: 'inventory-adjust-client-0002',
        }),
      },
    );
  });
});
