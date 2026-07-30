import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  executeReviewProductCompliance,
  executeSubmitProductCompliance,
  getProductComplianceState,
} from './product-compliance-executor.js';

const nonce = `l53d2p-${Date.now()}`;
const ids = {
  admin: `${nonce}-admin`,
  category: `${nonce}-category`,
  supplier: `${nonce}-supplier`,
  product: `${nonce}-product`,
  qualification: `${nonce}-qualification`,
  batch: `${nonce}-batch`,
  evidence: `${nonce}-evidence`,
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
const admin_meta = { ip_address: '127.0.0.1', user_agent: 'l53-d2-product-test' };

function submitInput(idempotencyKey: string) {
  return {
    product_id: ids.product,
    context,
    admin_meta,
    command: {
      expected_fingerprint: null,
      expected_updated_at: null as Date | null,
      idempotency_key: idempotencyKey,
    },
  };
}

async function guardedSubmitInput(idempotencyKey: string) {
  const state = await getProductComplianceState(ids.product);
  return {
    ...submitInput(idempotencyKey),
    command: {
      expected_fingerprint: state.current_fingerprint,
      expected_updated_at: null,
      idempotency_key: idempotencyKey,
    },
  };
}

function reviewInput(
  reviewId: string,
  idempotencyKey: string,
  decision: 'approve' | 'reject' = 'approve',
) {
  return {
    review_id: reviewId,
    context,
    admin_meta,
    command: {
      decision,
      expected_status: 'submitted' as const,
      review_note: decision === 'approve' ? '合规事实核验通过' : '合规事实不完整',
      idempotency_key: idempotencyKey,
    },
  };
}

async function seedComplianceFacts() {
  await prisma.supplierQualification.create({
    data: {
      id: ids.qualification,
      supplier_id: ids.supplier,
      qualification_type: 'business_license',
      version: 1,
      status: 'approved',
      object_key: `compliance/${nonce}/business-license.pdf`,
      file_sha256: 'a'.repeat(64),
      masked_summary: { holder: '测***公司' },
      critical_fingerprint: 'qualification-fingerprint-1',
      submitted_by_admin_id: ids.admin,
      reviewed_by_admin_id: ids.admin,
      reviewed_at: new Date('2026-07-29T09:00:00.000Z'),
      review_note: '测试资质通过',
      valid_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.productBatch.create({
    data: {
      id: ids.batch,
      batch_no: `${nonce}-batch-no`,
      product_id: ids.product,
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
      file_sha256: 'b'.repeat(64),
      masked_summary: { voucher: '采***001' },
      evidence_fingerprint: 'batch-evidence-fingerprint-1',
      created_by_admin_id: ids.admin,
    },
  });
}

async function installReceiptCompletionFailureTrigger() {
  const trigger = `l53d2p_receipt_${nonce.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const fn = `${trigger}_fn`;
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "AdminCommandReceipt"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${fn}() RETURNS trigger AS $l53d2p$
     BEGIN
       IF NEW.operation = 'admin.product.compliance.review.v1'
          AND NEW.response_code = 'ADMIN_PRODUCT_COMPLIANCE_REVIEWED' THEN
         RAISE EXCEPTION 'forced product compliance receipt completion failure';
       END IF;
       RETURN NEW;
     END;
     $l53d2p$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${trigger}
     BEFORE UPDATE ON "AdminCommandReceipt"
     FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "AdminCommandReceipt"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
  };
}

beforeAll(async () => {
  await prisma.adminUser.create({
    data: { id: ids.admin, username: ids.admin, password_hash: 'integration', status: 'active' },
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
      status: 'active',
      subject_type: 'company',
      profile_fingerprint: 'supplier-profile-fingerprint-1',
    },
  });
  await prisma.product.create({
    data: {
      id: ids.product,
      name: ids.product,
      category_id: ids.category,
      primary_supplier_id: ids.supplier,
      origin_text: '南京市江宁区',
      labels: ['当季'],
      images: ['images/test.jpg'],
      price_cents: 1000,
      cost_price_cents: 600,
      stock: 10,
      unit: '份',
      status: 'active',
    },
  });
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.productComplianceReview.deleteMany({ where: { product_id: ids.product } }),
    prisma.productBatchEvidence.deleteMany({ where: { batch_id: ids.batch } }),
    prisma.productBatch.deleteMany({ where: { id: ids.batch } }),
    prisma.supplierQualification.deleteMany({ where: { supplier_id: ids.supplier } }),
    prisma.adminAuditLog.deleteMany({ where: { admin_user_id: ids.admin } }),
    prisma.adminCommandReceipt.deleteMany({ where: { admin_user_id: ids.admin } }),
  ]);
  await prisma.product.update({
    where: { id: ids.product },
    data: {
      name: ids.product,
      primary_supplier_id: ids.supplier,
      origin_text: '南京市江宁区',
      labels: ['当季'],
      images: ['images/test.jpg'],
      price_cents: 1000,
      stock: 10,
    },
  });
  await prisma.category.update({
    where: { id: ids.category },
    data: { compliance_code: 'vegetable', status: 'active' },
  });
  await prisma.supplier.update({
    where: { id: ids.supplier },
    data: {
      status: 'active',
      subject_type: 'company',
      profile_fingerprint: 'supplier-profile-fingerprint-1',
      profile_version: 1,
    },
  });
  await seedComplianceFacts();
});

afterAll(async () => {
  await prisma.productComplianceReview.deleteMany({ where: { product_id: ids.product } });
  await prisma.productBatchEvidence.deleteMany({ where: { batch_id: ids.batch } });
  await prisma.productBatch.deleteMany({ where: { id: ids.batch } });
  await prisma.supplierQualification.deleteMany({ where: { supplier_id: ids.supplier } });
  await prisma.adminAuditLog.deleteMany({ where: { admin_user_id: ids.admin } });
  await prisma.adminCommandReceipt.deleteMany({ where: { admin_user_id: ids.admin } });
  await prisma.product.deleteMany({ where: { id: ids.product } });
  await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
  await prisma.category.deleteMany({ where: { id: ids.category } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('product compliance executor on PostgreSQL', () => {
  it('allows the submitting administrator to perform a separate review action', async () => {
    const submitted = await executeSubmitProductCompliance(
      await guardedSubmitInput('product-submit-two-action-01'),
    );
    expect(submitted).toMatchObject({
      status: 'submitted',
      effective_valid: false,
      reason_codes: ['PRODUCT_COMPLIANCE_NOT_APPROVED'],
    });

    const approved = await executeReviewProductCompliance(
      reviewInput(submitted.id, 'product-review-two-action-01'),
    );
    expect(approved).toMatchObject({
      status: 'approved',
      reviewed_by_admin_id: ids.admin,
      effective_valid: true,
      reason_codes: [],
    });
    await expect(
      prisma.adminAuditLog.count({
        where: { admin_user_id: ids.admin, target_id: submitted.id },
      }),
    ).resolves.toBe(2);
  });

  it('rejects submission when required current facts are missing', async () => {
    await prisma.productBatchEvidence.deleteMany({ where: { batch_id: ids.batch } });
    const state = await getProductComplianceState(ids.product);
    await expect(
      executeSubmitProductCompliance({
        ...submitInput('product-submit-missing-facts-01'),
        command: {
          expected_fingerprint: state.current_fingerprint,
          expected_updated_at: null,
          idempotency_key: 'product-submit-missing-facts-01',
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE',
      reason_codes: ['PRODUCT_BATCH_EVIDENCE_INVALID'],
    });
  });

  it('fails closed for missing category, supplier, and latest qualification facts', async () => {
    await prisma.category.update({
      where: { id: ids.category },
      data: { compliance_code: null },
    });
    await expect(
      executeSubmitProductCompliance(
        await guardedSubmitInput('product-submit-missing-category-01'),
      ),
    ).rejects.toMatchObject({
      code: 'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE',
      reason_codes: expect.arrayContaining(['CATEGORY_CODE_MISSING']),
    });
    await prisma.category.update({
      where: { id: ids.category },
      data: { compliance_code: 'vegetable' },
    });

    await prisma.product.update({
      where: { id: ids.product },
      data: { primary_supplier_id: null },
    });
    await expect(
      executeSubmitProductCompliance(
        await guardedSubmitInput('product-submit-missing-supplier-01'),
      ),
    ).rejects.toMatchObject({
      code: 'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE',
      reason_codes: expect.arrayContaining(['PRODUCT_SUPPLIER_MISSING']),
    });
    await prisma.product.update({
      where: { id: ids.product },
      data: { primary_supplier_id: ids.supplier },
    });

    await prisma.supplierQualification.create({
      data: {
        supplier_id: ids.supplier,
        qualification_type: 'business_license',
        version: 2,
        status: 'submitted',
        object_key: `compliance/${nonce}/replacement-license.pdf`,
        file_sha256: 'c'.repeat(64),
        masked_summary: { holder: '替***公司' },
        critical_fingerprint: 'qualification-fingerprint-2',
        submitted_by_admin_id: ids.admin,
      },
    });
    await expect(
      executeSubmitProductCompliance(
        await guardedSubmitInput('product-submit-latest-qualification-01'),
      ),
    ).rejects.toMatchObject({
      code: 'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE',
      reason_codes: expect.arrayContaining(['SUPPLIER_QUALIFICATION_INVALID']),
    });
  });

  it('preserves approval when only price and stock change', async () => {
    const submitted = await executeSubmitProductCompliance(
      await guardedSubmitInput('product-submit-operational-01'),
    );
    await executeReviewProductCompliance(
      reviewInput(submitted.id, 'product-review-operational-01'),
    );
    await prisma.product.update({
      where: { id: ids.product },
      data: { price_cents: 880, stock: 2 },
    });
    await expect(getProductComplianceState(ids.product)).resolves.toMatchObject({
      latest_review: { id: submitted.id, effective_valid: true, reason_codes: [] },
    });
  });

  it('recomputes database-backed invalidation for supplier, qualification, and evidence changes', async () => {
    const submitted = await executeSubmitProductCompliance(
      await guardedSubmitInput('product-submit-db-invalidation-01'),
    );
    await executeReviewProductCompliance(
      reviewInput(submitted.id, 'product-review-db-invalidation-01'),
    );

    await prisma.supplier.update({
      where: { id: ids.supplier },
      data: { status: 'disabled' },
    });
    await expect(getProductComplianceState(ids.product)).resolves.toMatchObject({
      latest_review: {
        effective_valid: false,
        reason_codes: expect.arrayContaining(['SUPPLIER_INACTIVE']),
      },
    });
    await prisma.supplier.update({
      where: { id: ids.supplier },
      data: { status: 'active' },
    });

    await prisma.supplierQualification.update({
      where: { id: ids.qualification },
      data: { status: 'revoked', revoked_at: new Date() },
    });
    await expect(getProductComplianceState(ids.product)).resolves.toMatchObject({
      latest_review: {
        effective_valid: false,
        reason_codes: expect.arrayContaining(['SUPPLIER_QUALIFICATION_INVALID']),
      },
    });
    await prisma.supplierQualification.update({
      where: { id: ids.qualification },
      data: { status: 'approved', revoked_at: null },
    });

    await prisma.productBatchEvidence.update({
      where: { id: ids.evidence },
      data: { evidence_fingerprint: 'batch-evidence-fingerprint-2' },
    });
    await expect(getProductComplianceState(ids.product)).resolves.toMatchObject({
      latest_review: {
        effective_valid: false,
        reason_codes: ['PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED'],
      },
    });
  });

  it('allows only one concurrent submitted-to-reviewed transition', async () => {
    const submitted = await executeSubmitProductCompliance(
      await guardedSubmitInput('product-submit-race-0001'),
    );
    const settled = await Promise.allSettled([
      executeReviewProductCompliance(
        reviewInput(submitted.id, 'product-review-race-0001'),
      ),
      executeReviewProductCompliance(
        reviewInput(submitted.id, 'product-review-race-0002', 'reject'),
      ),
    ]);
    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(settled.find((entry) => entry.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        statusCode: 409,
        code: 'ADMIN_PRODUCT_COMPLIANCE_STATUS_CONFLICT',
      }),
    });
  });

  it('rolls back the decision and inserted audit when later receipt completion fails', async () => {
    const submitted = await executeSubmitProductCompliance(
      await guardedSubmitInput('product-submit-rollback-01'),
    );
    const removeTrigger = await installReceiptCompletionFailureTrigger();
    try {
      await expect(
        executeReviewProductCompliance(
          reviewInput(submitted.id, 'product-review-rollback-01'),
        ),
      ).rejects.toBeTruthy();
    } finally {
      await removeTrigger();
    }
    await expect(
      prisma.productComplianceReview.findUniqueOrThrow({ where: { id: submitted.id } }),
    ).resolves.toMatchObject({ status: 'submitted', reviewed_at: null });
    await expect(
      prisma.adminAuditLog.count({
        where: { action: 'product_compliance_reviewed', target_id: submitted.id },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.adminCommandReceipt.count({
        where: {
          admin_user_id: ids.admin,
          operation: 'admin.product.compliance.review.v1',
        },
      }),
    ).resolves.toBe(0);
  });

  it('replays submit and review commands without duplicating transitions', async () => {
    const submit = await guardedSubmitInput('product-submit-idempotent-01');
    const firstSubmit = await executeSubmitProductCompliance(submit);
    await expect(executeSubmitProductCompliance(submit)).resolves.toEqual(firstSubmit);

    const review = reviewInput(firstSubmit.id, 'product-review-idempotent-01');
    const firstReview = await executeReviewProductCompliance(review);
    await expect(executeReviewProductCompliance(review)).resolves.toEqual(firstReview);
    await expect(
      prisma.productComplianceReview.count({ where: { product_id: ids.product } }),
    ).resolves.toBe(1);
    await expect(
      prisma.adminAuditLog.count({
        where: { action: 'product_compliance_reviewed', target_id: firstSubmit.id },
      }),
    ).resolves.toBe(1);
  });

  it('recomputes dynamic validity when replaying a review after evidence revocation', async () => {
    const submitted = await executeSubmitProductCompliance(
      await guardedSubmitInput('product-submit-replay-fresh-01'),
    );
    const review = reviewInput(submitted.id, 'product-review-replay-fresh-01');
    await executeReviewProductCompliance(review);
    await prisma.productBatchEvidence.update({
      where: { id: ids.evidence },
      data: { status: 'revoked', revoked_at: new Date() },
    });

    await expect(executeReviewProductCompliance(review)).resolves.toMatchObject({
      status: 'approved',
      effective_valid: false,
      reason_codes: expect.arrayContaining([
        'PRODUCT_BATCH_EVIDENCE_INVALID',
        'PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED',
      ]),
    });
  });

  it('keeps reject as an explicit terminal review decision', async () => {
    const submitted = await executeSubmitProductCompliance(
      await guardedSubmitInput('product-submit-reject-0001'),
    );
    await expect(
      executeReviewProductCompliance(
        reviewInput(submitted.id, 'product-review-reject-0001', 'reject'),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      effective_valid: false,
      reason_codes: ['PRODUCT_COMPLIANCE_NOT_APPROVED'],
    });
  });
});
