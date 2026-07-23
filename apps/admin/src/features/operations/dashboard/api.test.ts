import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import { loadOperationsDashboard } from './api';

describe('operations dashboard loader', () => {
  it('loads the six existing endpoints in one feature boundary', async () => {
    const request = vi.fn(async <T>(path: string): Promise<T> => {
      return (path.endsWith('/overview') ? { order_count: 1 } : []) as T;
    }) as JsonRequester;

    const data = await loadOperationsDashboard(request);

    expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/operations/dashboard/overview',
      '/api/admin/operations/dashboard/trends?days=7',
      '/api/admin/operations/dashboard/products',
      '/api/admin/operations/dashboard/communities',
      '/api/admin/operations/dashboard/pickup-stores',
      '/api/admin/operations/dashboard/alerts',
    ]);
    expect(data.overview).toEqual({ order_count: 1 });
  });
});
