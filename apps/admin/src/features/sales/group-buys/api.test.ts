import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  cloneGroupBuy,
  closeGroupBuy,
  closeUnpaidOrders,
  confirmRefund,
  loadClosureWorkbench,
  loadGroupBuys,
  markGroupBuyFailed,
} from './api';

describe('group-buy API boundary', () => {
  it('loads the existing group-buy endpoint', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => [{ id: 'g1' }] as T) as JsonRequester;

    await expect(loadGroupBuys(request, signal)).resolves.toEqual([{ id: 'g1' }]);

    expect(request).toHaveBeenCalledWith('/api/group-buys', { signal });
  });

  it('uses the existing closure workbench and mutation contracts', async () => {
    const request = vi.fn(async <T>(path: string): Promise<T> => {
      const data = path.endsWith('/closure-summary')
        ? { group_buy_id: 'g1' }
        : path.endsWith('/manual-refund-orders')
          ? { items: [{ order_id: 'o1' }] }
          : undefined;
      return data as T;
    }) as JsonRequester;

    await expect(loadClosureWorkbench('g1', request)).resolves.toEqual({
      summary: { group_buy_id: 'g1' },
      refundOrders: [{ order_id: 'o1' }],
    });
    await markGroupBuyFailed('g1', request);
    await closeUnpaidOrders('g1', request);
    await closeGroupBuy('g1', request);
    await confirmRefund('g1', 'o1', 'r1', request);
    await cloneGroupBuy(
      'g1',
      { end_time: '2026-07-24T00:00:00.000Z', pickup_time: '2026-07-25T00:00:00.000Z' },
      request,
    );

    expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/closure-summary', {
      signal: undefined,
    });
    expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/manual-refund-orders', {
      signal: undefined,
    });
    expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/mark-failed', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'Admin 人工确认团购失败',
        admin_note: '标记失败不等于退款完成',
      }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/close-unpaid-orders', {
      method: 'POST',
      body: JSON.stringify({ admin_note: '关闭未支付订单不会触发退款' }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/close', {
      method: 'POST',
      body: JSON.stringify({ admin_note: '最终关闭要求所有待办已完成' }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/orders/o1/confirm-refund', {
      method: 'POST',
      body: JSON.stringify({
        refund_id: 'r1',
        admin_note: '确认退款已完成必须基于成功退款记录',
      }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/clone', {
      method: 'POST',
      body: expect.any(String),
    });
  });
});
