import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SupplierQualificationCommandError } from '../modules/compliance/supplier-qualification-executor.js';
import { registerSupplierRoutes } from './suppliers.js';

const executor = vi.hoisted(() => ({
  submit: vi.fn(),
  review: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    adminUser: {
      findUnique: vi.fn(async () => ({ status: 'active' })),
    },
  },
}));

vi.mock('../modules/compliance/supplier-qualification-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/compliance/supplier-qualification-executor.js')>();
  return {
    ...actual,
    executeSubmitSupplierQualification: executor.submit,
    executeReviewSupplierQualification: executor.review,
    executeRevokeSupplierQualification: executor.revoke,
  };
});

const app = Fastify({ logger: false });
registerSupplierRoutes(app);

const authorized = {
  'x-admin-user-id': 'supplier-qualification-route-admin',
  'x-admin-role': 'super_admin',
};
const forbidden = {
  'x-admin-user-id': 'supplier-qualification-route-clerk',
  'x-admin-role': 'clerk',
};
const key = 'supplier-qualification-route-0001';
const publicDto = {
  id: 'qualification-1',
  supplier_id: 'supplier-1',
  qualification_type: 'business_license',
  version: 1,
  status: 'submitted',
  issued_at: null,
  valid_from: null,
  expires_at: null,
  submitted_at: '2026-07-29T00:00:00.000Z',
  reviewed_by_admin_id: null,
  reviewed_at: null,
  review_note: null,
  revoked_by_admin_id: null,
  revoked_at: null,
  revoke_reason: null,
};

const submitPayload = {
  qualification_type: 'business_license',
  object_key: 'compliance/supplier-1/license.pdf',
  file_sha256: 'a'.repeat(64),
  issued_at: '2026-01-01T00:00:00.000Z',
  valid_from: '2026-01-01T00:00:00.000Z',
  expires_at: '2027-01-01T00:00:00.000Z',
  masked_summary: { holder: '南***公司' },
  idempotency_key: key,
};

const routes = [
  {
    name: 'submit',
    url: '/api/admin/suppliers/supplier-1/qualifications/submit',
    payload: submitPayload,
    parserCode: 'INVALID_SUPPLIER_QUALIFICATION_SUBMIT_COMMAND',
    successCode: 'ADMIN_SUPPLIER_QUALIFICATION_SUBMITTED',
    internalCode: 'ADMIN_SUPPLIER_QUALIFICATION_SUBMIT_FAILED',
    invoke: executor.submit,
  },
  {
    name: 'review',
    url: '/api/admin/supplier-qualifications/qualification-1/review',
    payload: {
      decision: 'approve',
      expected_status: 'submitted',
      review_note: '资料核验通过',
      idempotency_key: 'supplier-qualification-review-01',
    },
    parserCode: 'INVALID_SUPPLIER_QUALIFICATION_REVIEW_COMMAND',
    successCode: 'ADMIN_SUPPLIER_QUALIFICATION_REVIEWED',
    internalCode: 'ADMIN_SUPPLIER_QUALIFICATION_REVIEW_FAILED',
    invoke: executor.review,
  },
  {
    name: 'revoke',
    url: '/api/admin/supplier-qualifications/qualification-1/revoke',
    payload: {
      expected_status: 'approved',
      reason: '发证机构确认撤销',
      idempotency_key: 'supplier-qualification-revoke-01',
    },
    parserCode: 'INVALID_SUPPLIER_QUALIFICATION_REVOKE_COMMAND',
    successCode: 'ADMIN_SUPPLIER_QUALIFICATION_REVOKED',
    internalCode: 'ADMIN_SUPPLIER_QUALIFICATION_REVOKE_FAILED',
    invoke: executor.revoke,
  },
] as const;

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('supplier qualification route contracts', () => {
  it.each(routes)('returns a V1 unauthorized envelope for $name', async ({ url, payload }) => {
    const response = await app.inject({ method: 'POST', url, payload });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: 'ADMIN_UNAUTHORIZED',
      trace_id: expect.any(String),
    });
  });

  it.each(routes)('returns a V1 forbidden envelope for $name', async ({ url, payload }) => {
    const response = await app.inject({ method: 'POST', url, headers: forbidden, payload });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: 'ADMIN_FORBIDDEN',
      trace_id: expect.any(String),
    });
  });

  it.each(routes)('returns the parser code in a V1 envelope for $name', async ({ url, parserCode }) => {
    const response = await app.inject({ method: 'POST', url, headers: authorized, payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: parserCode,
      trace_id: expect.any(String),
    });
  });

  it.each(routes)('returns a sanitized V1 success envelope for $name', async ({ url, payload, successCode, invoke }) => {
    invoke.mockResolvedValueOnce(publicDto);
    const response = await app.inject({ method: 'POST', url, headers: authorized, payload });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      code: successCode,
      trace_id: expect.any(String),
      data: publicDto,
    });
    expect(JSON.stringify(body)).not.toMatch(/object_key|file_sha256|masked_summary|identity_number|signed_url/i);
  });

  it('returns an executor conflict code in the review V1 envelope', async () => {
    executor.review.mockRejectedValueOnce(new SupplierQualificationCommandError(
      409,
      'ADMIN_SUPPLIER_QUALIFICATION_STATUS_CONFLICT',
      '供应商资质状态已变化，请刷新后重试',
    ));
    const review = routes[1];
    const response = await app.inject({ method: 'POST', url: review.url, headers: authorized, payload: review.payload });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: 'ADMIN_SUPPLIER_QUALIFICATION_STATUS_CONFLICT',
      trace_id: expect.any(String),
    });
  });

  it('returns a safe V1 internal failure for revoke', async () => {
    executor.revoke.mockRejectedValueOnce(new Error('private database detail'));
    const revoke = routes[2];
    const response = await app.inject({ method: 'POST', url: revoke.url, headers: authorized, payload: revoke.payload });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      data: null,
      code: revoke.internalCode,
      trace_id: expect.any(String),
    }));
    expect(response.body).not.toContain('private database detail');
  });
});
