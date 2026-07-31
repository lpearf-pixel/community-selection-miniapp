import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  executeReviewProductCompliance,
  executeSubmitProductCompliance,
  getProductComplianceState,
} from './product-compliance-executor.js';
import { evaluateComplianceRelease } from './compliance-release-evaluator.js';

const nonce = `l53d2r-${Date.now()}`;
const evaluationTime = new Date('2026-07-30T06:00:00.000Z');
const ids = {
  admin: `${nonce}-admin`,
  category: `${nonce}-category`,
  supplier: `${nonce}-supplier`,
  activeProduct: `${nonce}-active-product`,
  draftProduct: `${nonce}-draft-product`,
  qualification: `${nonce}-qualification`,
  batch: `${nonce}-batch`,
  evidence: `${nonce}-evidence`,
};
const secrets = {
  phone: '13800138000',
  identity: '320101199001011234',
  objectKey: `private/${nonce}/320101199001011234.pdf`,
  signedUrl:
    'https://storage.invalid/private.pdf?X-Amz-Signature=release-secret',
};
const context: AdminAccessContext = {
  admin_user_id: ids.admin,
  role: 'super_admin',
  permissions: ['admin.full_access'],
  is_super_admin: true,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: true,
    can_access_all_communities: true,
  },
  data_scope_source: 'session',
};

beforeAll(async () => {
  await prisma.adminUser.create({
    data: {
      id: ids.admin,
      username: ids.admin,
      password_hash: 'integration',
      status: 'active',
    },
  });
  await prisma.category.create({
    data: {
      id: ids.category,
      name: ids.category,
      compliance_code: 'vegetable',
      status: 'active',
    },
  });
  await prisma.supplier.create({
    data: {
      id: ids.supplier,
      name: ids.supplier,
      contact_phone: secrets.phone,
      license_no: secrets.identity,
      certification_info: { signed_url: secrets.signedUrl },
      status: 'active',
      subject_type: 'company',
      profile_fingerprint: 'supplier-profile-fingerprint-release-1',
    },
  });
  await prisma.product.createMany({
    data: [
      {
        id: ids.activeProduct,
        name: ids.activeProduct,
        category_id: ids.category,
        primary_supplier_id: ids.supplier,
        origin_text: '南京市江宁区',
        labels: ['当季'],
        images: ['images/release-active.jpg'],
        price_cents: 1000,
        cost_price_cents: 600,
        stock: 10,
        unit: '份',
        status: 'active',
      },
      {
        id: ids.draftProduct,
        name: ids.draftProduct,
        category_id: ids.category,
        price_cents: 1000,
        cost_price_cents: 600,
        stock: 0,
        unit: '份',
        status: 'draft',
      },
    ],
  });
  await prisma.supplierQualification.create({
    data: {
      id: ids.qualification,
      supplier_id: ids.supplier,
      qualification_type: 'business_license',
      version: 1,
      status: 'approved',
      object_key: secrets.objectKey,
      file_sha256: 'a'.repeat(64),
      masked_summary: { holder: '测***公司' },
      critical_fingerprint: 'qualification-fingerprint-release-1',
      submitted_by_admin_id: ids.admin,
      reviewed_by_admin_id: ids.admin,
      reviewed_at: new Date('2026-07-29T09:00:00.000Z'),
      review_note: '测试资质通过',
      valid_from: new Date(
        evaluationTime.getTime() - 24 * 60 * 60 * 1000,
      ),
      expires_at: new Date(
        evaluationTime.getTime() + 365 * 24 * 60 * 60 * 1000,
      ),
    },
  });
  await prisma.productBatch.create({
    data: {
      id: ids.batch,
      batch_no: `${nonce}-batch-no`,
      product_id: ids.activeProduct,
      supplier_id: ids.supplier,
      product_name_snapshot: nonce,
      supplier_name_snapshot: nonce,
      stock_unit: 'piece',
      initial_quantity: 10,
      remaining_quantity: 10,
      origin_text: '南京市江宁区',
      arrival_date: new Date('2026-07-29T08:00:00.000Z'),
    },
  });
  await prisma.productBatchEvidence.create({
    data: {
      id: ids.evidence,
      batch_id: ids.batch,
      evidence_type: 'purchase_voucher',
      status: 'active',
      object_key: `private/${nonce}/purchase-voucher.pdf`,
      file_sha256: 'b'.repeat(64),
      masked_summary: { voucher: '采***001' },
      evidence_fingerprint: 'batch-evidence-fingerprint-release-1',
      created_by_admin_id: ids.admin,
    },
  });

  const state = await getProductComplianceState(ids.activeProduct);
  const submitted = await executeSubmitProductCompliance({
    product_id: ids.activeProduct,
    context,
    admin_meta: {
      ip_address: '127.0.0.1',
      user_agent: 'l53-d2-release-test',
    },
    command: {
      expected_fingerprint: state.current_fingerprint,
      expected_updated_at: null,
      idempotency_key: `${nonce}-submit`,
    },
  });
  await executeReviewProductCompliance({
    review_id: submitted.id,
    context,
    admin_meta: {
      ip_address: '127.0.0.1',
      user_agent: 'l53-d2-release-test',
    },
    command: {
      decision: 'approve',
      expected_status: 'submitted',
      review_note: '合规发布测试通过',
      idempotency_key: `${nonce}-review`,
    },
  });
});

afterAll(async () => {
  await prisma.opsAlertLog.deleteMany({
    where: { alert_type: 'l53_d2_compliance_release_blocked' },
  });
  await prisma.productComplianceReview.deleteMany({
    where: { product_id: { in: [ids.activeProduct, ids.draftProduct] } },
  });
  await prisma.productBatchEvidence.deleteMany({ where: { batch_id: ids.batch } });
  await prisma.productBatch.deleteMany({ where: { id: ids.batch } });
  await prisma.supplierQualification.deleteMany({
    where: { supplier_id: ids.supplier },
  });
  await prisma.adminAuditLog.deleteMany({ where: { admin_user_id: ids.admin } });
  await prisma.adminCommandReceipt.deleteMany({
    where: { admin_user_id: ids.admin },
  });
  await prisma.product.deleteMany({
    where: { id: { in: [ids.activeProduct, ids.draftProduct] } },
  });
  await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
  await prisma.category.deleteMany({ where: { id: ids.category } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('compliance release evaluator on PostgreSQL', () => {
  it('gates only active products and emits sanitized passing evidence', async () => {
    const evidence = await evaluateComplianceRelease(prisma as never, {
      gitSha: 'integration-pass-sha',
      checkedAt: evaluationTime,
    });

    expect(evidence).toMatchObject({
      passed: true,
      git_sha: 'integration-pass-sha',
      checked_at: '2026-07-30T06:00:00.000Z',
    });
    expect(evidence.summary).toEqual({
      active_product_count: evidence.products.length,
      approved_valid_count: evidence.products.length,
      blocked_product_count: 0,
    });
    expect(evidence.products).toEqual(
      expect.arrayContaining([
        {
          product_id: ids.activeProduct,
          passed: true,
          reason_codes: [],
          current_fingerprint: expect.any(String),
          approved_fingerprint: expect.any(String),
          review_id: expect.any(String),
        },
      ]),
    );
    const json = JSON.stringify(evidence);
    expect(json).not.toContain(ids.draftProduct);
    for (const secret of Object.values(secrets)) {
      expect(json).not.toContain(secret);
    }
  });

  it('fails closed, emits stable reasons, and deduplicates sanitized alerts', async () => {
    await prisma.product.update({
      where: { id: ids.activeProduct },
      data: { description: '合规事实已变化' },
    });
    const input = {
      gitSha: 'integration-blocked-sha',
      checkedAt: new Date('2026-07-30T06:05:00.000Z'),
    };

    const first = await evaluateComplianceRelease(prisma as never, input);
    const second = await evaluateComplianceRelease(prisma as never, input);

    expect(first).toEqual(second);
    expect(first.passed).toBe(false);
    expect(first.summary).toEqual({
      active_product_count: first.products.length,
      approved_valid_count: first.products.length - 1,
      blocked_product_count: 1,
    });
    expect(first.products).toEqual(
      expect.arrayContaining([
        {
          product_id: ids.activeProduct,
          passed: false,
          reason_codes: ['PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED'],
          current_fingerprint: expect.any(String),
          approved_fingerprint: expect.any(String),
          review_id: expect.any(String),
        },
      ]),
    );
    expect(first.products.filter((product) => !product.passed)).toHaveLength(1);
    const alerts = await prisma.opsAlertLog.findMany({
      where: { alert_type: 'l53_d2_compliance_release_blocked' },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      alert_level: 'critical',
      status: 'open',
      title: '生产发布被商品合规门禁阻止',
      payload: {
        product_ids: [ids.activeProduct],
        reason_codes: ['PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED'],
      },
    });
    const json = JSON.stringify({ evidence: first, alerts });
    for (const secret of Object.values(secrets)) {
      expect(json).not.toContain(secret);
    }
  });
});
