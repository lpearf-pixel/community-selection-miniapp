import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import { loadExpiryAlerts } from './api';

describe('expiry-alert API boundary', () => {
  it('loads and unwraps the seven-day alert endpoint', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => ({
      items: [{ batch_id: 'b1' }],
    }) as T) as JsonRequester;

    await expect(loadExpiryAlerts(7, request, signal)).resolves.toEqual([
      { batch_id: 'b1' },
    ]);

    expect(request).toHaveBeenCalledWith(
      '/api/admin/inventory/expiry-alerts?days=7',
      { signal },
    );
  });
});
