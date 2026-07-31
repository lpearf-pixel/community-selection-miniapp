import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  accessComplianceEvidence,
  loadProductCompliance,
  reviewProductCompliance,
  submitProductCompliance,
} from './api';

describe('product compliance Admin API boundary', () => {
  it('uses exact read, submit, review and audited evidence access contracts', async () => {
    const request = vi.fn(async <T>(): Promise<T> => ({}) as T) as JsonRequester;

    await loadProductCompliance('product-1', request);
    await submitProductCompliance(
      'product-1',
      'a'.repeat(64),
      'submit-idempotency-0001',
      request,
    );
    await reviewProductCompliance(
      'review-1',
      'approve',
      '材料完整且来源可复核',
      'review-idempotency-0001',
      request,
    );
    await accessComplianceEvidence(
      'supplier_qualification',
      'qualification-1',
      '复核供应商营业执照',
      request,
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/admin/products/product-1/compliance',
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/admin/products/product-1/compliance/submit',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_fingerprint: 'a'.repeat(64),
          idempotency_key: 'submit-idempotency-0001',
        }),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      '/api/admin/product-compliance-reviews/review-1/review',
      {
        method: 'POST',
        body: JSON.stringify({
          decision: 'approve',
          expected_status: 'submitted',
          review_note: '材料完整且来源可复核',
          idempotency_key: 'review-idempotency-0001',
        }),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      '/api/admin/compliance-evidence/supplier_qualification/qualification-1/access',
      {
        method: 'POST',
        body: JSON.stringify({ purpose: '复核供应商营业执照' }),
      },
    );
  });

});
