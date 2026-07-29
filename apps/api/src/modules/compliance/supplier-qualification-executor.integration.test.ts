import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  executeReviewSupplierQualification,
  executeRevokeSupplierQualification,
  executeSubmitSupplierQualification,
} from './supplier-qualification-executor.js';

const nonce = `l53d2q-${Date.now()}`;
const ids = {
  admin: `${nonce}-admin`,
  supplier: `${nonce}-supplier`,
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

const admin_meta = { ip_address: '127.0.0.1', user_agent: 'l53-d2-test' };

function submitInput(idempotency_key: string, extra: Record<string, unknown> = {}) {
  return {
    supplier_id: ids.supplier,
    context,
    admin_meta,
    command: {
      qualification_type: 'business_license',
      object_key: `compliance/${nonce}/${idempotency_key}.pdf`,
      file_sha256: 'a'.repeat(64),
      issued_at: new Date('2026-01-01T00:00:00.000Z'),
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
      expires_at: new Date('2027-01-01T00:00:00.000Z'),
      masked_summary: { holder: '南***公司', license: '9132********1234' },
      idempotency_key,
      ...extra,
    },
  };
}

function reviewInput(
  qualification_id: string,
  idempotency_key: string,
  decision: 'approve' | 'reject' = 'approve',
) {
  return {
    qualification_id,
    context,
    admin_meta,
    command: {
      decision,
      expected_status: 'submitted' as const,
      review_note: decision === 'approve' ? '资料核验通过' : '资料不完整',
      idempotency_key,
    },
  };
}

async function qualificationCount() {
  return prisma.supplierQualification.count({ where: { supplier_id: ids.supplier } });
}

async function installAuditFailureTrigger() {
  const trigger = `l53d2q_audit_${nonce.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const fn = `${trigger}_fn`;
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "AdminAuditLog"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${fn}() RETURNS trigger AS $l53d2q$
     BEGIN
       IF NEW.action = 'supplier_qualification_submitted' THEN
         RAISE EXCEPTION 'forced qualification audit failure';
       END IF;
       RETURN NEW;
     END;
     $l53d2q$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${trigger}
     BEFORE INSERT ON "AdminAuditLog"
     FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "AdminAuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
  };
}

beforeAll(async () => {
  await prisma.adminUser.create({
    data: { id: ids.admin, username: ids.admin, password_hash: 'integration', status: 'active' },
  });
  await prisma.supplier.create({
    data: { id: ids.supplier, name: ids.supplier, status: 'active', subject_type: 'company' },
  });
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.supplierQualification.deleteMany({ where: { supplier_id: ids.supplier } }),
    prisma.adminAuditLog.deleteMany({ where: { admin_user_id: ids.admin } }),
    prisma.adminCommandReceipt.deleteMany({ where: { admin_user_id: ids.admin } }),
  ]);
});

afterAll(async () => {
  await prisma.supplierQualification.deleteMany({ where: { supplier_id: ids.supplier } });
  await prisma.adminAuditLog.deleteMany({ where: { admin_user_id: ids.admin } });
  await prisma.adminCommandReceipt.deleteMany({ where: { admin_user_id: ids.admin } });
  await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('supplier qualification executor on PostgreSQL', () => {
  it('submits an immutable qualification with an audit and receipt atomically', async () => {
    const result = await executeSubmitSupplierQualification(submitInput('submit-atomic-0001'));

    expect(result).toMatchObject({
      supplier_id: ids.supplier,
      qualification_type: 'business_license',
      version: 1,
      status: 'submitted',
    });
    await expect(qualificationCount()).resolves.toBe(1);
    await expect(prisma.adminAuditLog.count({ where: { action: 'supplier_qualification_submitted' } })).resolves.toBe(1);
    await expect(prisma.adminCommandReceipt.count({ where: { admin_user_id: ids.admin } })).resolves.toBe(1);
  });

  it('keeps approve and reject as explicit review commands and permits the submitting administrator to review', async () => {
    const approved = await executeSubmitSupplierQualification(submitInput('submit-approve-0001'));
    const rejected = await executeSubmitSupplierQualification(submitInput('submit-reject-0001', {
      qualification_type: 'food_business_license',
    }));

    await expect(executeReviewSupplierQualification(reviewInput(approved.id, 'review-approve-001'))).resolves.toMatchObject({ status: 'approved' });
    await expect(executeReviewSupplierQualification(reviewInput(rejected.id, 'review-reject-0001', 'reject'))).resolves.toMatchObject({ status: 'rejected' });
    await expect(prisma.supplierQualification.findUniqueOrThrow({ where: { id: approved.id } })).resolves.toMatchObject({ reviewed_by_admin_id: ids.admin, status: 'approved' });
  });

  it('creates a replacement row without rewriting the prior evidence row', async () => {
    const first = await executeSubmitSupplierQualification(submitInput('submit-v1-00000001'));
    const before = await prisma.supplierQualification.findUniqueOrThrow({ where: { id: first.id } });
    const second = await executeSubmitSupplierQualification(submitInput('submit-v2-00000001', {
      object_key: `compliance/${nonce}/replacement.pdf`,
      file_sha256: 'b'.repeat(64),
      masked_summary: { holder: '苏***公司' },
    }));

    expect(second).toMatchObject({ version: 2, status: 'submitted' });
    await expect(prisma.supplierQualification.findUniqueOrThrow({ where: { id: first.id } })).resolves.toMatchObject({
      object_key: before.object_key,
      file_sha256: before.file_sha256,
      masked_summary: before.masked_summary,
      version: 1,
    });
  });

  it('revokes decision state without exposing or changing historical evidence', async () => {
    const submitted = await executeSubmitSupplierQualification(submitInput('submit-revoke-0001'));
    await executeReviewSupplierQualification(reviewInput(submitted.id, 'review-revoke-0001'));
    const before = await prisma.supplierQualification.findUniqueOrThrow({ where: { id: submitted.id } });
    const revoked = await executeRevokeSupplierQualification({
      qualification_id: submitted.id,
      context,
      admin_meta,
      command: { expected_status: 'approved', reason: '发证机构确认撤销', idempotency_key: 'revoke-qualification-01' },
    });
    const after = await prisma.supplierQualification.findUniqueOrThrow({ where: { id: submitted.id } });

    expect(revoked).toMatchObject({ id: submitted.id, status: 'revoked' });
    expect(revoked).not.toHaveProperty('object_key');
    expect(revoked).not.toHaveProperty('file_sha256');
    expect(revoked).not.toHaveProperty('masked_summary');
    expect(after).toMatchObject({
      object_key: before.object_key,
      file_sha256: before.file_sha256,
      masked_summary: before.masked_summary,
      status: 'revoked',
      revoked_by_admin_id: ids.admin,
    });
  });

  it('allows only one concurrent submitted-to-reviewed transition', async () => {
    const submitted = await executeSubmitSupplierQualification(submitInput('submit-race-000001'));
    const settled = await Promise.allSettled([
      executeReviewSupplierQualification(reviewInput(submitted.id, 'review-race-00001')),
      executeReviewSupplierQualification(reviewInput(submitted.id, 'review-race-00002', 'reject')),
    ]);

    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(settled.find((entry) => entry.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ statusCode: 409, code: 'ADMIN_SUPPLIER_QUALIFICATION_STATUS_CONFLICT' }),
    });
  });

  it('rolls back qualification, audit, and receipt writes when an audit insertion fails', async () => {
    const removeTrigger = await installAuditFailureTrigger();
    try {
      await expect(executeSubmitSupplierQualification(submitInput('submit-rollback-001'))).rejects.toBeTruthy();
    } finally {
      await removeTrigger();
    }

    await expect(qualificationCount()).resolves.toBe(0);
    await expect(prisma.adminAuditLog.count({ where: { admin_user_id: ids.admin } })).resolves.toBe(0);
    await expect(prisma.adminCommandReceipt.count({ where: { admin_user_id: ids.admin } })).resolves.toBe(0);
  });

  it('replays a command once and rejects reuse of its idempotency key for different input', async () => {
    const first = await executeSubmitSupplierQualification(submitInput('submit-idempotent-01'));
    await expect(executeSubmitSupplierQualification(submitInput('submit-idempotent-01'))).resolves.toEqual(first);
    await expect(executeSubmitSupplierQualification(submitInput('submit-idempotent-01', { file_sha256: 'c'.repeat(64) }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
    await expect(qualificationCount()).resolves.toBe(1);
  });

  it('replays review once and rejects a changed review payload without a second transition', async () => {
    const submitted = await executeSubmitSupplierQualification(submitInput('submit-review-idempotency-01'));
    const review = reviewInput(submitted.id, 'review-idempotency-0001');
    const first = await executeReviewSupplierQualification(review);
    const replay = await executeReviewSupplierQualification(review);

    expect(replay).toEqual(first);
    await expect(executeReviewSupplierQualification(reviewInput(
      submitted.id,
      'review-idempotency-0001',
      'reject',
    ))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
    await expect(prisma.supplierQualification.findUniqueOrThrow({ where: { id: submitted.id } })).resolves.toMatchObject({
      status: 'approved',
      reviewed_at: first.reviewed_at === null ? undefined : new Date(first.reviewed_at),
    });
    await expect(prisma.adminAuditLog.count({
      where: { action: 'supplier_qualification_reviewed', target_id: submitted.id },
    })).resolves.toBe(1);
    await expect(prisma.adminCommandReceipt.count({
      where: { admin_user_id: ids.admin, operation: 'admin.supplier.qualification.review.v1', target_id: submitted.id },
    })).resolves.toBe(1);
  });

  it('replays revoke once and rejects a changed revoke payload without a second transition', async () => {
    const submitted = await executeSubmitSupplierQualification(submitInput('submit-revoke-idempotency-01'));
    await executeReviewSupplierQualification(reviewInput(submitted.id, 'review-before-revoke-001'));
    const revoke = {
      qualification_id: submitted.id,
      context,
      admin_meta,
      command: {
        expected_status: 'approved' as const,
        reason: '发证机构确认撤销',
        idempotency_key: 'revoke-idempotency-0001',
      },
    };
    const first = await executeRevokeSupplierQualification(revoke);
    const replay = await executeRevokeSupplierQualification(revoke);

    expect(replay).toEqual(first);
    await expect(executeRevokeSupplierQualification({
      ...revoke,
      command: { ...revoke.command, reason: '另一项撤销原因' },
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
    await expect(prisma.supplierQualification.findUniqueOrThrow({ where: { id: submitted.id } })).resolves.toMatchObject({
      status: 'revoked',
      revoked_at: first.revoked_at === null ? undefined : new Date(first.revoked_at),
      revoke_reason: '发证机构确认撤销',
    });
    await expect(prisma.adminAuditLog.count({
      where: { action: 'supplier_qualification_revoked', target_id: submitted.id },
    })).resolves.toBe(1);
    await expect(prisma.adminCommandReceipt.count({
      where: { admin_user_id: ids.admin, operation: 'admin.supplier.qualification.revoke.v1', target_id: submitted.id },
    })).resolves.toBe(1);
  });
});
