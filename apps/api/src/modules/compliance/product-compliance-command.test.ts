import { describe, expect, it } from 'vitest';
import {
  hasValidProductComplianceSubmitGuard,
  parseReviewProductComplianceCommand,
  parseSubmitProductComplianceCommand,
} from './product-compliance-command.js';

describe('L53-D2 product compliance commands', () => {
  it('fails closed when a direct caller bypasses the parser without exactly one guard', () => {
    expect(
      hasValidProductComplianceSubmitGuard({
        expected_updated_at: null,
        expected_fingerprint: null,
      }),
    ).toBe(false);
    expect(
      hasValidProductComplianceSubmitGuard({
        expected_updated_at: new Date('2026-07-29T12:00:00.000Z'),
        expected_fingerprint: 'a'.repeat(64),
      }),
    ).toBe(false);
    expect(
      hasValidProductComplianceSubmitGuard({
        expected_updated_at: null,
        expected_fingerprint: 'a'.repeat(64),
      }),
    ).toBe(true);
  });
  it('accepts a submit guarded by the product update timestamp', () => {
    expect(
      parseSubmitProductComplianceCommand({
        expected_updated_at: '2026-07-29T12:00:00.000Z',
        idempotency_key: 'product-submit-0001',
      }),
    ).toEqual({
      ok: true,
      value: {
        expected_updated_at: new Date('2026-07-29T12:00:00.000Z'),
        expected_fingerprint: null,
        idempotency_key: 'product-submit-0001',
      },
    });
  });

  it('accepts a submit guarded by the current fingerprint', () => {
    const fingerprint = 'a'.repeat(64);
    expect(
      parseSubmitProductComplianceCommand({
        expected_fingerprint: fingerprint,
        idempotency_key: 'product-submit-0002',
      }),
    ).toEqual({
      ok: true,
      value: {
        expected_updated_at: null,
        expected_fingerprint: fingerprint,
        idempotency_key: 'product-submit-0002',
      },
    });
  });

  it.each([
    {},
    { idempotency_key: 'product-submit-0003' },
    {
      expected_updated_at: '2026-07-29T12:00:00.000Z',
      expected_fingerprint: 'a'.repeat(64),
      idempotency_key: 'product-submit-0004',
    },
    {
      expected_updated_at: 'not-a-date',
      idempotency_key: 'product-submit-0005',
    },
    {
      expected_fingerprint: 'ABC',
      idempotency_key: 'product-submit-0006',
    },
    {
      expected_fingerprint: 'a'.repeat(64),
      idempotency_key: 'short',
    },
    {
      expected_fingerprint: 'a'.repeat(64),
      idempotency_key: 'product-submit-0007',
      auto_approve: true,
    },
    {
      expected_fingerprint: 'a'.repeat(64),
      idempotency_key: 'product-submit-0008',
      decision: 'approve',
      review_note: '合并审核',
    },
  ])('rejects an unsafe product submission payload %#', (payload) => {
    expect(parseSubmitProductComplianceCommand(payload)).toEqual({
      ok: false,
      code: 'INVALID_PRODUCT_COMPLIANCE_SUBMIT_COMMAND',
      message: '商品合规提交命令不合法',
    });
  });

  it.each(['approve', 'reject'] as const)(
    'accepts an explicit %s review action',
    (decision) => {
      expect(
        parseReviewProductComplianceCommand({
          decision,
          expected_status: 'submitted',
          review_note: decision === 'approve' ? '材料完整' : '缺少产地证明',
          idempotency_key: `product-review-${decision}-0001`,
        }),
      ).toEqual({
        ok: true,
        value: {
          decision,
          expected_status: 'submitted',
          review_note: decision === 'approve' ? '材料完整' : '缺少产地证明',
          idempotency_key: `product-review-${decision}-0001`,
        },
      });
    },
  );

  it.each([
    {},
    {
      decision: 'approve',
      expected_status: 'submitted',
      review_note: '',
      idempotency_key: 'product-review-0002',
    },
    {
      decision: 'approve',
      expected_status: 'approved',
      review_note: '重复审批',
      idempotency_key: 'product-review-0003',
    },
    {
      decision: 'auto_approve',
      expected_status: 'submitted',
      review_note: '自动审批',
      idempotency_key: 'product-review-0004',
    },
    {
      decision: 'approve',
      expected_status: 'submitted',
      review_note: '材料完整',
      idempotency_key: 'product-review-0005',
      submit: true,
    },
  ])('rejects an unsafe product review payload %#', (payload) => {
    expect(parseReviewProductComplianceCommand(payload)).toEqual({
      ok: false,
      code: 'INVALID_PRODUCT_COMPLIANCE_REVIEW_COMMAND',
      message: '商品合规审核命令不合法',
    });
  });
});
