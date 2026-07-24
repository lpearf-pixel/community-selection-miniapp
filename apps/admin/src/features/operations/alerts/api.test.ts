import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  ignoreOperationsAlert,
  listOperationsAlerts,
  resolveOperationsAlert,
} from './api';

describe('operations alert API boundary', () => {
  it('loads alerts with the caller signal', async () => {
    const signal = new AbortController().signal;
    const data = [{ id: 'a1', status: 'open' }];
    const request = vi.fn(async <T>(): Promise<T> => data as T) as JsonRequester;

    await expect(
      listOperationsAlerts(request, signal),
    ).resolves.toEqual(data);
    expect(request).toHaveBeenCalledWith('/api/admin/logs/alerts', {
      signal,
    });
  });

  it('keeps resolve and ignore payloads unchanged', async () => {
    const request = vi.fn(async <T>(): Promise<T> => undefined as T) as JsonRequester;
    const payload = {
      resolved_by: 'admin',
      resolution_note: '后台人工处理',
    };

    await resolveOperationsAlert('a1', request);
    await ignoreOperationsAlert('a2', request);

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/admin/logs/alerts/a1/resolve',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/admin/logs/alerts/a2/ignore',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  });
});
