import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAdminComplianceRoutes } from './compliance.js';

const db = vi.hoisted(() => ({
  productFind: vi.fn(),
  supplierFind: vi.fn(),
  evidenceFind: vi.fn(),
  accessCreate: vi.fn(),
}));
const executor = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  prisma: {
    product: { findUnique: db.productFind },
    supplier: { findUnique: db.supplierFind },
    productBatchEvidence: { findMany: db.evidenceFind },
    complianceEvidenceAccessLog: { create: db.accessCreate },
  },
}));

vi.mock(
  '../../modules/compliance/product-compliance-executor.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../modules/compliance/product-compliance-executor.js')
      >();
    return { ...actual, getProductComplianceState: executor.get };
  },
);

vi.mock('@community-selection/shared', () => ({
  contractOk: (data: unknown, meta: { code: string; message: string; traceId: string }) => ({
    success: true,
    data,
    code: meta.code,
    message: meta.message,
    trace_id: meta.traceId,
  }),
  contractFail: (meta: { code: string; message: string; traceId: string }) => ({
    success: false,
    data: null,
    code: meta.code,
    message: meta.message,
    trace_id: meta.traceId,
  }),
}));

const authorized = {
  'x-admin-user-id': 'compliance-admin-1',
  'x-admin-role': 'super_admin',
  'user-agent': 'focused-test-agent',
};

describe('audited compliance evidence access boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.productFind.mockResolvedValue(null);
    db.supplierFind.mockResolvedValue(null);
    db.evidenceFind.mockResolvedValue([]);
    db.accessCreate.mockResolvedValue({ id: 'access-log-default' });
    executor.get.mockResolvedValue({
      product_id: 'product-1',
      current_fingerprint: 'a'.repeat(64),
      eligible_for_submission: true,
      reason_codes: [],
      latest_review: null,
      rule_versions: {
        category: 'l53-d2-category-v1',
        qualification: 'l53-d2-supplier-qualification-v1',
        fingerprint: 'l53-d2-product-fingerprint-v2',
      },
    });
  });

  it('writes the denied audit before returning adapter unavailable without an object key', async () => {
    db.accessCreate.mockResolvedValueOnce({ id: 'access-log-1' });
    const app = Fastify({ logger: false });
    registerAdminComplianceRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/compliance-evidence/supplier_qualification/qualification-1/access',
      headers: authorized,
      payload: { purpose: '复核供应商营业执照' },
    });
    await app.close();

    expect(db.accessCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        admin_user_id: 'compliance-admin-1',
        evidence_type: 'supplier_qualification',
        evidence_id: 'qualification-1',
        purpose: '复核供应商营业执照',
        outcome: 'denied_adapter_unavailable',
        user_agent: 'focused-test-agent',
      }),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'EVIDENCE_DOWNLOAD_UNAVAILABLE',
      data: null,
    });
    expect(response.body).not.toMatch(/object_key|signed_url|storage/i);
  });

  it('fails closed when the mandatory access audit cannot be written', async () => {
    db.accessCreate.mockRejectedValueOnce(
      new Error('private database failure'),
    );
    const app = Fastify({ logger: false });
    registerAdminComplianceRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/compliance-evidence/product_batch_evidence/evidence-1/access',
      headers: authorized,
      payload: { purpose: '复核批次采购凭证' },
    });
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'EVIDENCE_ACCESS_AUDIT_FAILED',
      data: null,
    });
    expect(response.body).not.toContain('private database failure');
  });

  it.each([
    [{ purpose: '' }, 'INVALID_EVIDENCE_ACCESS_COMMAND'],
    [{ purpose: 'x'.repeat(501) }, 'INVALID_EVIDENCE_ACCESS_COMMAND'],
  ])('rejects malformed purpose without creating an audit row', async (payload, code) => {
    const app = Fastify({ logger: false });
    registerAdminComplianceRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/compliance-evidence/supplier_qualification/qualification-1/access',
      headers: authorized,
      payload,
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, code });
    expect(db.accessCreate).not.toHaveBeenCalled();
  });

  it('returns only sanitized supplier qualification metadata', async () => {
    db.supplierFind.mockResolvedValueOnce({
      id: 'supplier-1',
      name: '众彩 A18 档口',
      subject_type: 'market_stall',
      status: 'active',
      source_address: null,
      market_name: '南京众彩市场',
      stall_no: 'A-18',
      profile_fingerprint: 'c'.repeat(64),
      profile_version: 2,
      qualifications: [
        {
          id: 'qualification-1',
          qualification_type: 'market_stall_registration',
          version: 2,
          status: 'approved',
          valid_from: new Date('2026-01-01T00:00:00.000Z'),
          expires_at: new Date('2027-01-01T00:00:00.000Z'),
          masked_summary: {
            stall_no_masked: 'A-**',
            object_key: 'compliance/private/stall.pdf',
            raw_url: 'https://storage.example/signed',
            id_card_no: '320101199001011234',
            bank_account: '6222020202020202020',
            market_name_masked: '南*京*众*彩*市*场*一*区',
          },
        },
      ],
    });
    const app = Fastify({ logger: false });
    registerAdminComplianceRoutes(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/suppliers/supplier-1/compliance',
      headers: authorized,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      code: 'ADMIN_SUPPLIER_COMPLIANCE_READ',
      data: {
        id: 'supplier-1',
        subject_type: 'market_stall',
        source_complete: true,
        qualifications: [
          {
            id: 'qualification-1',
            status: 'approved',
            masked_summary: { stall_no_masked: 'A-**' },
          },
        ],
      },
    });
    expect(response.body).not.toMatch(
      /object_key|storage\.example|file_sha256|320101199001011234|6222020202020202020|南\*京\*众\*彩\*市\*场\*一\*区/i,
    );
  });

  it('loads product batch evidence only for the current primary supplier', async () => {
    db.productFind.mockResolvedValueOnce({
      primary_supplier: {
        id: 'supplier-primary',
        subject_type: 'company',
        status: 'active',
        source_address: null,
        market_name: null,
        stall_no: null,
        profile_fingerprint: 'd'.repeat(64),
        profile_version: 1,
        qualifications: [],
      },
    });
    db.evidenceFind.mockResolvedValueOnce([]);
    const app = Fastify({ logger: false });
    registerAdminComplianceRoutes(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/products/product-1/compliance',
      headers: authorized,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(db.evidenceFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          batch: {
            product_id: 'product-1',
            supplier_id: 'supplier-primary',
          },
        },
      }),
    );
  });

  it('does not expose historical batch evidence when the product has no primary supplier', async () => {
    db.productFind.mockResolvedValueOnce({ primary_supplier: null });
    const app = Fastify({ logger: false });
    registerAdminComplianceRoutes(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/products/product-1/compliance',
      headers: authorized,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { supplier: null, batch_evidence: [] },
    });
    expect(db.evidenceFind).not.toHaveBeenCalled();
  });

  it('never marks a temporary source profile complete', async () => {
    db.supplierFind.mockResolvedValueOnce({
      id: 'supplier-temporary',
      name: '临时来源',
      subject_type: 'temporary_source',
      status: 'active',
      source_address: '南京临时采购点',
      market_name: null,
      stall_no: null,
      profile_fingerprint: 'e'.repeat(64),
      profile_version: 3,
      qualifications: [],
    });
    const app = Fastify({ logger: false });
    registerAdminComplianceRoutes(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/suppliers/supplier-temporary/compliance',
      headers: authorized,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        subject_type: 'temporary_source',
        source_complete: false,
      },
    });
  });
});
