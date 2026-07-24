import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  getTaxReviewDetail,
  listTaxReviews,
  submitTaxReview,
  taxReviewExportPath,
} from './api';

describe('tax review API boundary', () => {
  it('loads the filtered list and detail with caller signals', async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async <T>(path: string): Promise<T> => {
      const data = path.endsWith('/tr1')
        ? { tax_record_id: 'tr1' }
        : { items: [], total: 0, page: 1, page_size: 20 };
      return data as T;
    }) as JsonRequester;

    await listTaxReviews(
      {
        keyword: 'leader',
        tax_status: 'pending',
        page: 1,
        page_size: 20,
      },
      request,
      signal,
    );
    await getTaxReviewDetail('tr1', request, signal);

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/admin/tax-records?keyword=leader&tax_status=pending&page=1&page_size=20',
      { signal },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/admin/tax-records/tr1',
      { signal },
    );
  });

  it('keeps the optimistic tax review payload unchanged', async () => {
    const request = vi.fn(async <T>(): Promise<T> => undefined as T) as JsonRequester;
    const payload = {
      tax_mode: 'withheld',
      taxable_amount_cents: 1000,
      tax_amount_cents: 30,
      tax_rate_basis: '人工依据',
      invoice_status: 'not_required',
      tax_remark: '复核完成',
      client_request_id: 'tax-review-1',
      expected_updated_at: '2026-07-23T00:00:00.000Z',
    };

    await submitTaxReview('w1', payload, request);

    expect(request).toHaveBeenCalledWith(
      '/api/admin/withdrawals/w1/tax-review',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  });

  it('builds the existing internal CSV export endpoint', () => {
    expect(
      taxReviewExportPath({
        tax_mode: 'invoice',
        from: '2026-07-01',
        to: '2026-07-23',
      }),
    ).toBe(
      '/api/admin/tax-records/export.csv?tax_mode=invoice&from=2026-07-01&to=2026-07-23',
    );
  });
});
