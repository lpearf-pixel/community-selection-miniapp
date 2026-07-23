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

  it('keeps ledger and adjustment contracts unchanged', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => [] as T) as JsonRequester;

    await loadStockLedger('p1', request, signal);
    await adjustInventory('p1', -2, '盘亏', request);

    expect(request).toHaveBeenCalledWith(
      '/api/admin/inventory/ledger?product_id=p1',
      { signal },
    );
    expect(request).toHaveBeenCalledWith(
      '/api/admin/inventory/products/p1/adjust',
      {
        method: 'POST',
        body: JSON.stringify({ adjust_quantity: -2, reason: '盘亏' }),
      },
    );
  });
});
