import { describe, expect, it } from 'vitest';
import {
  buildCurrentProductCompliance,
  evaluateProductComplianceState,
  type ProductComplianceFacts,
  type ProductComplianceReviewState,
} from './product-compliance-executor.js';

const now = new Date('2026-07-29T12:00:00.000Z');

function facts(): ProductComplianceFacts {
  return {
    product: {
      id: 'product-1',
      name: '有机番茄',
      description: '当天采摘',
      category_code: 'vegetable',
      supplier_id: 'supplier-1',
      origin_text: '南京市江宁区',
      labels: ['有机', '当季'],
      cover_image: 'images/tomato-cover.jpg',
      images: ['images/tomato-a.jpg'],
      updated_at: new Date('2026-07-29T10:00:00.000Z'),
    },
    supplier: {
      id: 'supplier-1',
      status: 'active',
      subject_type: 'company',
      profile_fingerprint: 'profile-hash-1',
      profile_version: 1,
    },
    qualifications: [
      {
        id: 'qualification-1',
        qualification_type: 'business_license',
        version: 1,
        status: 'approved',
        critical_fingerprint: 'qualification-hash-1',
        valid_from: new Date('2026-01-01T00:00:00.000Z'),
        expires_at: new Date('2027-01-01T00:00:00.000Z'),
        revoked_at: null,
      },
    ],
    batch_evidence: [
      {
        id: 'evidence-1',
        batch_id: 'batch-1',
        status: 'active',
        evidence_type: 'purchase_voucher',
        evidence_fingerprint: 'evidence-hash-1',
        expires_at: null,
        revoked_at: null,
      },
    ],
  };
}

function approvedReview(input: ProductComplianceFacts): ProductComplianceReviewState {
  const current = buildCurrentProductCompliance(input, now);
  if (!current.eligible) throw new Error('fixture must be eligible');
  return {
    id: 'review-1',
    status: 'approved',
    compliance_fingerprint: current.compliance_fingerprint,
  };
}

describe('L53-D2 dynamic product compliance validity', () => {
  it('treats submit-only state as not production-valid', () => {
    const currentFacts = facts();
    const current = buildCurrentProductCompliance(currentFacts, now);
    expect(
      evaluateProductComplianceState(currentFacts, {
        id: 'review-1',
        status: 'submitted',
        compliance_fingerprint: current.compliance_fingerprint,
      }, now),
    ).toMatchObject({
      valid: false,
      reason_codes: ['PRODUCT_COMPLIANCE_NOT_APPROVED'],
    });
  });

  it.each([
    ['name', (input: ProductComplianceFacts) => {
      input.product.name = '有机小番茄';
    }],
    ['description', (input: ProductComplianceFacts) => {
      input.product.description = '次日采摘';
    }],
    ['category', (input: ProductComplianceFacts) => {
      input.product.category_code = 'fruit';
    }],
    ['supplier', (input: ProductComplianceFacts) => {
      input.product.supplier_id = 'supplier-2';
      input.supplier!.id = 'supplier-2';
    }],
    ['supplier subject type', (input: ProductComplianceFacts) => {
      input.supplier!.subject_type = 'cooperative';
    }],
    ['supplier profile fingerprint', (input: ProductComplianceFacts) => {
      input.supplier!.profile_fingerprint = 'profile-hash-2';
    }],
    ['supplier profile version', (input: ProductComplianceFacts) => {
      input.supplier!.profile_version = 2;
    }],
    ['origin', (input: ProductComplianceFacts) => {
      input.product.origin_text = '南京市六合区';
    }],
    ['qualification hash', (input: ProductComplianceFacts) => {
      input.qualifications[0]!.critical_fingerprint = 'qualification-hash-2';
    }],
    ['batch evidence hash', (input: ProductComplianceFacts) => {
      input.batch_evidence[0]!.evidence_fingerprint = 'evidence-hash-2';
    }],
    ['labels', (input: ProductComplianceFacts) => {
      input.product.labels = ['精选'];
    }],
    ['cover', (input: ProductComplianceFacts) => {
      input.product.cover_image = 'images/tomato-cover-v2.jpg';
    }],
    ['images', (input: ProductComplianceFacts) => {
      input.product.images = ['images/tomato-b.jpg'];
    }],
  ] as const)('invalidates approval when %s changes', (_name, mutate) => {
    const original = facts();
    const review = approvedReview(original);
    const changed = facts();
    mutate(changed);
    expect(evaluateProductComplianceState(changed, review, now)).toMatchObject({
      valid: false,
      reason_codes: ['PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED'],
    });
  });

  it.each([
    ['inactive supplier', (input: ProductComplianceFacts) => {
      input.supplier!.status = 'disabled';
    }, 'SUPPLIER_INACTIVE'],
    ['missing supplier profile fingerprint', (input: ProductComplianceFacts) => {
      input.supplier!.profile_fingerprint = null;
    }, 'SUPPLIER_PROFILE_INCOMPLETE'],
    ['expired qualification', (input: ProductComplianceFacts) => {
      input.qualifications[0]!.expires_at = new Date('2026-07-29T11:59:59.000Z');
    }, 'SUPPLIER_QUALIFICATION_INVALID'],
    ['revoked qualification', (input: ProductComplianceFacts) => {
      input.qualifications[0]!.status = 'revoked';
      input.qualifications[0]!.revoked_at = now;
    }, 'SUPPLIER_QUALIFICATION_INVALID'],
    ['revoked batch evidence', (input: ProductComplianceFacts) => {
      input.batch_evidence[0]!.status = 'revoked';
      input.batch_evidence[0]!.revoked_at = now;
    }, 'PRODUCT_BATCH_EVIDENCE_INVALID'],
    ['unreviewed qualification status', (input: ProductComplianceFacts) => {
      input.qualifications[0]!.status = 'active';
    }, 'SUPPLIER_QUALIFICATION_INVALID'],
    ['wrong batch evidence status', (input: ProductComplianceFacts) => {
      input.batch_evidence[0]!.status = 'approved';
    }, 'PRODUCT_BATCH_EVIDENCE_INVALID'],
  ] as const)('fails closed for %s', (_name, mutate, reason) => {
    const original = facts();
    const review = approvedReview(original);
    const changed = facts();
    mutate(changed);
    expect(evaluateProductComplianceState(changed, review, now)).toMatchObject({
      valid: false,
      reason_codes: expect.arrayContaining([reason]),
    });
  });

  it('builds sanitized immutable snapshots without controlled object references', () => {
    const current = buildCurrentProductCompliance(facts(), now);
    expect(current.eligible).toBe(true);
    const serialized = JSON.stringify(current.snapshots);
    expect(serialized).not.toContain('object_key');
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain('identity_number');
    expect(current.snapshots).toMatchObject({
      product: { id: 'product-1', name: '有机番茄' },
      supplier: { id: 'supplier-1', profile_fingerprint: 'profile-hash-1' },
      qualifications: [{ id: 'qualification-1', critical_fingerprint: 'qualification-hash-1' }],
      batch_evidence: [{ id: 'evidence-1', evidence_fingerprint: 'evidence-hash-1' }],
    });
  });
});
