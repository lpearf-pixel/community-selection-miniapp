import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProductComplianceCommandError } from '../../modules/compliance/product-compliance-executor.js';
import { registerAdminComplianceRoutes } from './compliance.js';

const executor = vi.hoisted(() => ({
  get: vi.fn(),
  submit: vi.fn(),
  review: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  prisma: {
    adminUser: {
      findUnique: vi.fn(async () => ({ status: 'active' })),
    },
  },
}));

vi.mock(
  '../../modules/compliance/product-compliance-executor.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../modules/compliance/product-compliance-executor.js')
      >();
    return {
      ...actual,
      getProductComplianceState: executor.get,
      executeSubmitProductCompliance: executor.submit,
      executeReviewProductCompliance: executor.review,
    };
  },
);

const app = Fastify({ logger: false });
registerAdminComplianceRoutes(app);

const authorized = {
  'x-admin-user-id': 'product-compliance-route-admin',
  'x-admin-role': 'super_admin',
};
const forbidden = {
  'x-admin-user-id': 'product-compliance-route-clerk',
  'x-admin-role': 'clerk',
};

const stateDto = {
  product_id: 'product-1',
  product_updated_at: '2026-07-29T10:00:00.000Z',
  current_fingerprint: 'a'.repeat(64),
  eligible_for_submission: true,
  reason_codes: [],
  latest_review: null,
  rule_versions: {
    category: 'l53-d2-category-v1',
    qualification: 'l53-d2-supplier-qualification-v1',
    fingerprint: 'l53-d2-product-fingerprint-v2',
  },
};
const reviewDto = {
  id: 'review-1',
  product_id: 'product-1',
  status: 'submitted',
  compliance_fingerprint: 'a'.repeat(64),
  fingerprint_version: 'l53-d2-product-fingerprint-v2',
  category_rule_version: 'l53-d2-category-v1',
  qualification_rule_version: 'l53-d2-supplier-qualification-v1',
  submitted_by_admin_id: 'product-compliance-route-admin',
  submitted_at: '2026-07-29T12:00:00.000Z',
  reviewed_by_admin_id: null,
  reviewed_at: null,
  review_note: null,
  effective_valid: false,
  reason_codes: ['PRODUCT_COMPLIANCE_NOT_APPROVED'],
};

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('product compliance Admin V1 route contracts', () => {
  it.each([
    ['GET', '/api/admin/products/product-1/compliance', undefined],
    [
      'POST',
      '/api/admin/products/product-1/compliance/submit',
      {
        expected_fingerprint: 'a'.repeat(64),
        idempotency_key: 'product-compliance-submit-route-01',
      },
    ],
    [
      'POST',
      '/api/admin/product-compliance-reviews/review-1/review',
      {
        decision: 'approve',
        expected_status: 'submitted',
        review_note: '材料完整',
        idempotency_key: 'product-compliance-review-route-01',
      },
    ],
  ] as const)(
    'returns a V1 authorization envelope for %s %s',
    async (method, url, payload) => {
      const unauthorized = await app.inject({ method, url, payload });
      expect(unauthorized.statusCode).toBe(401);
      expect(unauthorized.json()).toMatchObject({
        success: false,
        data: null,
        code: 'ADMIN_UNAUTHORIZED',
        trace_id: expect.any(String),
      });

      const denied = await app.inject({
        method,
        url,
        headers: forbidden,
        payload,
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({
        success: false,
        data: null,
        code: 'ADMIN_FORBIDDEN',
        trace_id: expect.any(String),
      });
    },
  );

  it('returns sanitized current state without evidence object references', async () => {
    executor.get.mockResolvedValueOnce(stateDto);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/products/product-1/compliance',
      headers: authorized,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      code: 'ADMIN_PRODUCT_COMPLIANCE_READ',
      data: stateDto,
      trace_id: expect.any(String),
    });
    expect(response.body).not.toMatch(
      /object_key|file_sha256|identity_number|signed_url/i,
    );
  });

  it.each([
    [
      '/api/admin/products/product-1/compliance/submit',
      'INVALID_PRODUCT_COMPLIANCE_SUBMIT_COMMAND',
    ],
    [
      '/api/admin/product-compliance-reviews/review-1/review',
      'INVALID_PRODUCT_COMPLIANCE_REVIEW_COMMAND',
    ],
  ])('returns the parser code for malformed command %s', async (url, code) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: authorized,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code,
      trace_id: expect.any(String),
    });
  });

  it('submits and reviews through separate V1 command endpoints', async () => {
    executor.submit.mockResolvedValueOnce(reviewDto);
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/admin/products/product-1/compliance/submit',
      headers: authorized,
      payload: {
        expected_fingerprint: 'a'.repeat(64),
        idempotency_key: 'product-compliance-submit-route-02',
      },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({
      success: true,
      code: 'ADMIN_PRODUCT_COMPLIANCE_SUBMITTED',
      data: { status: 'submitted' },
      trace_id: expect.any(String),
    });

    executor.review.mockResolvedValueOnce({
      ...reviewDto,
      status: 'approved',
      effective_valid: true,
      reason_codes: [],
    });
    const reviewed = await app.inject({
      method: 'POST',
      url: '/api/admin/product-compliance-reviews/review-1/review',
      headers: authorized,
      payload: {
        decision: 'approve',
        expected_status: 'submitted',
        review_note: '材料完整',
        idempotency_key: 'product-compliance-review-route-02',
      },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toMatchObject({
      success: true,
      code: 'ADMIN_PRODUCT_COMPLIANCE_REVIEWED',
      data: { status: 'approved', effective_valid: true },
      trace_id: expect.any(String),
    });
  });

  it('preserves stable executor errors and hides unknown failure details', async () => {
    executor.submit.mockRejectedValueOnce(
      new ProductComplianceCommandError(
        422,
        'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE',
        '商品合规事实不完整',
        ['PRODUCT_BATCH_EVIDENCE_INVALID'],
      ),
    );
    const incomplete = await app.inject({
      method: 'POST',
      url: '/api/admin/products/product-1/compliance/submit',
      headers: authorized,
      payload: {
        expected_fingerprint: 'a'.repeat(64),
        idempotency_key: 'product-compliance-submit-route-03',
      },
    });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json()).toMatchObject({
      success: false,
      code: 'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE',
      data: null,
      trace_id: expect.any(String),
    });

    executor.review.mockRejectedValueOnce(new Error('private database detail'));
    const failed = await app.inject({
      method: 'POST',
      url: '/api/admin/product-compliance-reviews/review-1/review',
      headers: authorized,
      payload: {
        decision: 'approve',
        expected_status: 'submitted',
        review_note: '材料完整',
        idempotency_key: 'product-compliance-review-route-03',
      },
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({
      success: false,
      data: null,
      code: 'ADMIN_PRODUCT_COMPLIANCE_REVIEW_FAILED',
      trace_id: expect.any(String),
    });
    expect(failed.body).not.toContain('private database detail');
  });
});
