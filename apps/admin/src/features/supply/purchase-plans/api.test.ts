import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  cancelPurchasePlan,
  confirmPurchasePlan,
  createPurchasePlan,
  loadPurchasePlans,
  receivePurchasePlan,
} from './api';

describe('purchase-plan API boundary', () => {
  it('loads purchase plans with the caller signal', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => [] as T) as JsonRequester;

    await loadPurchasePlans(request, signal);

    expect(request).toHaveBeenCalledWith('/api/admin/purchase-plans', {
      signal,
    });
  });

  it('keeps create, transition, and receive payloads unchanged', async () => {
    const request = vi.fn(async <T>(): Promise<T> => undefined as T) as JsonRequester;
    const createInput = {
      target_date: '2026-07-24T00:00:00.000Z',
      supplier_name: '默认供应商',
      remark: '后台创建采购计划：采购数量与入库库存数量分开记录',
      items: [
        {
          product_id: 'p1',
          purchase_quantity: 3,
          purchase_unit: '箱',
          stock_in_quantity: 24,
          cost_price_cents: 1200,
          remark: '采购 3箱，入库 24斤',
        },
      ],
    };
    const receiveInput = {
      remark: '后台采购入库',
      items: [{ item_id: 'i1', received_quantity: 4 }],
    };

    await createPurchasePlan(createInput, request);
    await confirmPurchasePlan('plan-1', request);
    await cancelPurchasePlan('plan-1', request);
    await receivePurchasePlan('plan-1', receiveInput, request);

    expect(request).toHaveBeenCalledWith('/api/admin/purchase-plans', {
      method: 'POST',
      body: JSON.stringify(createInput),
    });
    expect(request).toHaveBeenCalledWith(
      '/api/admin/purchase-plans/plan-1/confirm',
      { method: 'POST' },
    );
    expect(request).toHaveBeenCalledWith(
      '/api/admin/purchase-plans/plan-1/cancel',
      { method: 'POST' },
    );
    expect(request).toHaveBeenCalledWith(
      '/api/admin/purchase-plans/plan-1/receive',
      {
        method: 'POST',
        body: JSON.stringify(receiveInput),
      },
    );
  });
});
