import { describe, expect, it, vi } from 'vitest';
import type { JsonRequester } from '../../../shared/api/client';
import {
  loadSupplierCompliance,
  reviewSupplierQualification,
  submitSupplierQualification,
  updateSupplierSubjectProfile,
} from './api';

describe('supplier compliance Admin API boundary', () => {
  it('uses sanitized profile and separate qualification command endpoints', async () => {
    const request = vi.fn(async <T>(): Promise<T> => ({}) as T) as JsonRequester;

    await loadSupplierCompliance('supplier-1', request);
    await updateSupplierSubjectProfile(
      'supplier-1',
      {
        subject_type: 'market_stall',
        source_address: null,
        market_name: '南京众彩市场',
        stall_no: 'A-18',
      },
      request,
    );
    await submitSupplierQualification(
      'supplier-1',
      {
        qualification_type: 'market_stall_registration',
        object_key: 'compliance/suppliers/supplier-1/stall.pdf',
        file_sha256: 'b'.repeat(64),
        issued_at: null,
        valid_from: '2026-01-01T00:00:00.000Z',
        expires_at: '2027-01-01T00:00:00.000Z',
        masked_summary: { stall_no_masked: 'A-**' },
        idempotency_key: 'qualification-submit-0001',
      },
      request,
    );
    await reviewSupplierQualification(
      'qualification-1',
      'approve',
      '档口登记与主体一致',
      'qualification-review-0001',
      request,
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/admin/suppliers/supplier-1/compliance',
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/admin/suppliers/supplier-1/update',
      {
        method: 'POST',
        body: JSON.stringify({
          subject_profile: {
            subject_type: 'market_stall',
            source_address: null,
            market_name: '南京众彩市场',
            stall_no: 'A-18',
          },
        }),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      '/api/admin/suppliers/supplier-1/qualifications/submit',
      {
        method: 'POST',
        body: expect.not.stringContaining('https://'),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      '/api/admin/supplier-qualifications/qualification-1/review',
      {
        method: 'POST',
        body: JSON.stringify({
          decision: 'approve',
          expected_status: 'submitted',
          review_note: '档口登记与主体一致',
          idempotency_key: 'qualification-review-0001',
        }),
      },
    );
  });
});
