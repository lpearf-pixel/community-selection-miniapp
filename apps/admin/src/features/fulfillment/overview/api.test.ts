import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import { loadFulfillmentOverview } from './api';

describe('fulfillment overview API boundary', () => {
  it('loads the existing fulfillment overview endpoint', async () => {
    const request = vi.fn(async <T>(): Promise<T> => ({ today_group_buys: 1 }) as T) as JsonRequester;

    await expect(loadFulfillmentOverview(request)).resolves.toEqual({
      today_group_buys: 1,
    });

    expect(request).toHaveBeenCalledWith('/api/admin/fulfillment/overview', {
      signal: undefined,
    });
  });
});
