import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  addAfterSaleNote,
  linkAfterSaleLoss,
  loadAfterSales,
  resolveAfterSale,
  reviewAfterSale,
} from './api';

describe('after-sales API boundary', () => {
  it('loads the existing after-sales endpoint', async () => {
    const request = vi.fn(async <T>(): Promise<T> => [{ id: 'a1' }] as T) as JsonRequester;

    await expect(loadAfterSales(request)).resolves.toEqual([{ id: 'a1' }]);

    expect(request).toHaveBeenCalledWith('/api/admin/after-sales', {
      signal: undefined,
    });
  });

  it('uses the existing after-sales mutation contracts', async () => {
    const request = vi.fn(async <T>(): Promise<T> => undefined as T) as JsonRequester;

    await reviewAfterSale('a1', {
      status: 'approved',
      approved_refund_cents: 100,
      resolution_type: 'partial_refund',
      responsibility: 'supplier',
      admin_note: '审核通过',
    }, request);
    await resolveAfterSale('a1', {
      resolution_type: 'partial_refund',
      approved_refund_cents: 100,
      admin_note: '处理完成',
    }, request);
    await addAfterSaleNote('a1', '备注', request);
    await linkAfterSaleLoss('a1', {
      product_id: 'p1',
      batch_id: 'b1',
      quantity: 1,
      reason: 'after_sale_refund',
      remark: '关联损耗',
    }, request);

    expect(request).toHaveBeenCalledWith('/api/admin/after-sales/a1/review', {
      method: 'POST',
      body: JSON.stringify({
        status: 'approved',
        approved_refund_cents: 100,
        resolution_type: 'partial_refund',
        responsibility: 'supplier',
        admin_note: '审核通过',
      }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/after-sales/a1/resolve', {
      method: 'POST',
      body: JSON.stringify({
        resolution_type: 'partial_refund',
        approved_refund_cents: 100,
        admin_note: '处理完成',
      }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/after-sales/a1/add-note', {
      method: 'POST',
      body: JSON.stringify({ admin_note: '备注' }),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/after-sales/a1/link-loss', {
      method: 'POST',
      body: JSON.stringify({
        product_id: 'p1',
        batch_id: 'b1',
        quantity: 1,
        reason: 'after_sale_refund',
        remark: '关联损耗',
      }),
    });
  });
});
