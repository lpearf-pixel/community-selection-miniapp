import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  getPickingExportUrl,
  loadOrderAiContext,
  loadOrders,
  updateOrderStatus,
  verifyOrderPickup,
} from './api';
import type {
  AdminOrderListResponse,
  OpsAlert,
} from './types';

describe('orders API boundary', () => {
  it('loads the protected Admin order endpoint with deterministic filters', async () => {
    const response: AdminOrderListResponse = {
      items: [],
      pagination: {
        page: 2,
        page_size: 50,
        total: 1,
        total_pages: 1,
        has_previous: true,
        has_next: false,
      },
    };
    const request = vi.fn(async <T>(): Promise<T> => response as T) as JsonRequester;

    await expect(
      loadOrders(
        {
          keyword: 'WX-100',
          order_type: 'group_buy',
          pickup_type: 'delivery',
          page: 2,
          page_size: 50,
        },
        request,
      ),
    ).resolves.toEqual(response);

    expect(request).toHaveBeenCalledWith(
      '/api/admin/orders?keyword=WX-100&order_type=group_buy&pickup_type=delivery&page=2&page_size=50',
      { signal: undefined },
    );
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

  it('uses the versioned Admin order status command', async () => {
    const request = vi.fn(async <T>(): Promise<T> => ({ order: { id: 'o1' } }) as T) as JsonRequester;

    await loadOrderAiContext('o1', request);
    await updateOrderStatus(
      'o1',
      'ready',
      3,
      'idem-123456789012',
      request,
    );
    await verifyOrderPickup('o1', '后台核销自提', request);

    expect(request).toHaveBeenCalledWith('/api/admin/logs/orders/o1/ai-context', {
      signal: undefined,
    });
    expect(request).toHaveBeenCalledWith('/api/admin/orders/o1/status', {
      method: 'POST',
      body: JSON.stringify({
        next_status: 'ready',
        expected_version: 3,
        idempotency_key: 'idem-123456789012',
      }),
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
