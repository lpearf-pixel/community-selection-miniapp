import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  confirmStockCheck,
  createStockCheck,
  loadStockChecks,
} from './api';

describe('stock-check API boundary', () => {
  it('loads stock checks with the caller signal', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => [] as T) as JsonRequester;

    await loadStockChecks(request, signal);

    expect(request).toHaveBeenCalledWith('/api/admin/stock-checks', { signal });
  });

  it('keeps stock-check create and confirm contracts unchanged', async () => {
    const request = vi.fn(async <T>(): Promise<T> => undefined as T) as JsonRequester;
    const input = {
      remark: '后台创建盘点',
      items: [
        {
          batch_id: 'b1',
          product_id: undefined,
          actual_quantity: 8,
          reason: '后台盘点',
        },
      ],
    };

    await createStockCheck(input, request);
    await confirmStockCheck('c1', request);

    expect(request).toHaveBeenCalledWith('/api/admin/stock-checks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/stock-checks/c1/confirm', {
      method: 'POST',
    });
  });
});
