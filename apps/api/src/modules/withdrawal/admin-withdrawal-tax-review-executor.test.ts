import { describe, expect, it } from 'vitest';
import {
  assertTaxReviewReceiptReplay,
  AdminWithdrawalTaxReviewError,
} from './admin-withdrawal-tax-review-executor.js';

const result = {
  withdrawal: {
    id: 'withdrawal-1',
    status: 'pending',
    version: 3,
  },
  tax_record: {
    id: 'tax-1',
    source_type: 'withdrawal',
    source_id: 'withdrawal-1',
  },
  idempotent: false,
};

describe('assertTaxReviewReceiptReplay', () => {
  it('returns the first completed response as an idempotent replay', () => {
    expect(
      assertTaxReviewReceiptReplay(
        {
          operation: 'admin.withdrawal.tax-review.v1',
          target_id: 'withdrawal-1',
          request_hash: 'hash-1',
          completed_at: new Date(),
          response_http_status: 200,
          response_code: 'ADMIN_WITHDRAWAL_TAX_REVIEWED',
          response_data: result,
        },
        {
          withdrawal_id: 'withdrawal-1',
          request_hash: 'hash-1',
        },
      ),
    ).toEqual({ ...result, idempotent: true });
  });

  it.each([
    { request_hash: 'other-hash' },
    { operation: 'admin.withdrawal.approve.v1' },
    { target_id: 'withdrawal-2' },
    { completed_at: null },
    { response_http_status: 500 },
    { response_data: null },
  ])('fails closed for a conflicting or incomplete receipt %#', (override) => {
    expect(() =>
      assertTaxReviewReceiptReplay(
        {
          operation: 'admin.withdrawal.tax-review.v1',
          target_id: 'withdrawal-1',
          request_hash: 'hash-1',
          completed_at: new Date(),
          response_http_status: 200,
          response_code: 'ADMIN_WITHDRAWAL_TAX_REVIEWED',
          response_data: result,
          ...override,
        },
        {
          withdrawal_id: 'withdrawal-1',
          request_hash: 'hash-1',
        },
      ),
    ).toThrowError(AdminWithdrawalTaxReviewError);
  });
});
