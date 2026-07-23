import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  getPickingExportUrl,
  loadOrderAiContext,
  loadOrders,
  updateOrderStatus,
  verifyOrderPickup,
} from './api';
import type { OpsAlert } from './types';

describe('orders API boundary', () => {
  it('loads the existing order endpoint', async () => {
    const request = vi.fn(async <T>(): Promise<T> => [{ id: 'o1' }] as T) as JsonRequester;

    await expect(loadOrders(request)).resolves.toEqual([{ id: 'o1' }]);

    expect(request).toHaveBeenCalledWith('/api/orders', { signal: undefined });
  });

  it('keeps the existing order alert DTO shape', () => {
    expectTypeOf<OpsAlert>().toEqualTypeOf<{
      id: string;
      alert_type: string;
      alert_level: string;
      status: string;
      order_id?: string | null;
      title: string;
      message: string;
    }>();
  });

  it('uses the existing order action contracts', async () => {
    const request = vi.fn(async <T>(): Promise<T> => ({ order: { id: 'o1' } }) as T) as JsonRequester;

    await loadOrderAiContext('o1', request);
    await updateOrderStatus('o1', 'ready', request);
    await verifyOrderPickup('o1', '后台核销自提', request);

    expect(request).toHaveBeenCalledWith('/api/admin/logs/orders/o1/ai-context', {
      signal: undefined,
    });
    expect(request).toHaveBeenCalledWith('/api/orders/o1/status', {
      method: 'POST',
      body: JSON.stringify({ next_status: 'ready' }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/orders/o1/pickup-verify', {
      method: 'POST',
      body: JSON.stringify({ admin_remark: '后台核销自提' }),
    });
    expect(getPickingExportUrl('detail')).toMatch(
      /\/api\/admin\/orders\/export\/picking\.csv\?format=detail$/,
    );
  });
});
