import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  loadBatchLedger,
  loadInventoryBatches,
  recordBatchLoss,
} from './api';

describe('inventory batch API boundary', () => {
  it('loads batches with the caller signal', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => [] as T) as JsonRequester;

    await loadInventoryBatches(request, signal);

    expect(request).toHaveBeenCalledWith('/api/admin/inventory/batches', {
      signal,
    });
  });

  it('keeps batch ledger and loss contracts unchanged', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => [] as T) as JsonRequester;
    const lossInput = {
      quantity: 2,
      loss_type: 'bad_fruit',
      reason: '坏果损耗',
      responsible_type: 'supplier',
    };

    await loadBatchLedger('b1', request, signal);
    await recordBatchLoss('b1', lossInput, request);

    expect(request).toHaveBeenCalledWith(
      '/api/admin/inventory/batches/b1/ledger',
      { signal },
    );
    expect(request).toHaveBeenCalledWith(
      '/api/admin/inventory/batches/b1/loss',
      {
        method: 'POST',
        body: JSON.stringify(lossInput),
      },
    );
  });
});
