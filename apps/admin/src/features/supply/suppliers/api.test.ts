import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  createSupplier,
  disableSupplier,
  loadSuppliers,
} from './api';

describe('supplier API boundary', () => {
  it('loads suppliers with the caller signal', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(): Promise<T> => [] as T) as JsonRequester;

    await loadSuppliers(request, signal);

    expect(request).toHaveBeenCalledWith('/api/admin/suppliers', { signal });
  });

  it('keeps supplier mutation contracts unchanged', async () => {
    const request = vi.fn(async <T>(): Promise<T> => undefined as T) as JsonRequester;
    const input = {
      name: '绿色农场',
      contact_name: '王经理',
      contact_phone: '13800000000',
      remark: '有机蔬菜',
    };

    await createSupplier(input, request);
    await disableSupplier('s1', request);

    expect(request).toHaveBeenCalledWith('/api/admin/suppliers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    expect(request).toHaveBeenCalledWith('/api/admin/suppliers/s1/disable', {
      method: 'POST',
    });
  });
});
