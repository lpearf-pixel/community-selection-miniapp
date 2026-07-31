import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compliance = vi.hoisted(() => ({
  loadCurrentComplianceFacts: vi.fn(),
  evaluateProductComplianceState: vi.fn(),
}));

vi.mock('./product-compliance-executor.js', () => ({
  FIRST_LAUNCH_CATEGORY_RULE_VERSION: 'l53-d2-category-v1',
  SUPPLIER_QUALIFICATION_RULE_VERSION:
    'l53-d2-supplier-qualification-v1',
  PRODUCT_COMPLIANCE_FINGERPRINT_VERSION:
    'l53-d2-product-fingerprint-v2',
  loadCurrentComplianceFacts: compliance.loadCurrentComplianceFacts,
  evaluateProductComplianceState: compliance.evaluateProductComplianceState,
}));

import { evaluateComplianceRelease } from './compliance-release-evaluator.js';

function failureDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function db(productIds = ['active-b', 'active-a']) {
  const alertByKey = new Map<string, unknown>();
  return {
    product: {
      findMany: vi.fn(async () => productIds.map((id) => ({ id }))),
    },
    productComplianceReview: {
      findFirst: vi.fn(async ({ where }: { where: { product_id: string } }) =>
        where.product_id === 'active-a'
          ? {
              id: 'review-a',
              status: 'approved',
              compliance_fingerprint: 'approved-a',
            }
          : null,
      ),
    },
    opsAlertLog: {
      upsert: vi.fn(async ({ where, create, update }) => {
        const current = alertByKey.get(where.dedupe_key);
        const next = current ? { ...current, ...update } : create;
        alertByKey.set(where.dedupe_key, next);
        return next;
      }),
    },
  };
}

describe('evaluateComplianceRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compliance.loadCurrentComplianceFacts.mockImplementation(
      async (_client: unknown, productId: string) => ({
        product: {
          id: productId,
          seeded_phone: '13800138000',
          identity: '320101199001011234',
          object_key: 'private/qualification.pdf',
          signed_url: 'https://storage.invalid/private?signature=secret',
        },
      }),
    );
    compliance.evaluateProductComplianceState.mockImplementation(
      (_facts: unknown, review: { id: string } | null) =>
        review
          ? {
              valid: true,
              reason_codes: [],
              current_fingerprint: 'current-a',
              approved_fingerprint: 'approved-a',
              review_id: review.id,
              review_status: 'approved',
              rule_versions: {
                category: 'l53-d2-category-v1',
                qualification: 'l53-d2-supplier-qualification-v1',
                fingerprint: 'l53-d2-product-fingerprint-v2',
              },
            }
          : {
              valid: false,
              reason_codes: [
                'PRODUCT_SUPPLIER_MISSING',
                'CATEGORY_NOT_ALLOWED',
              ],
              current_fingerprint: 'current-b',
              approved_fingerprint: null,
              review_id: null,
              review_status: null,
              rule_versions: {
                category: 'l53-d2-category-v1',
                qualification: 'l53-d2-supplier-qualification-v1',
                fingerprint: 'l53-d2-product-fingerprint-v2',
              },
            },
    );
  });

  it('gates only active products and emits deterministic sanitized evidence', async () => {
    const client = db();
    const checkedAt = new Date('2026-07-30T06:00:00.000Z');

    const result = await evaluateComplianceRelease(client as never, {
      gitSha: 'a523fc716355654c7672009886ed07d9f9a2177d',
      checkedAt,
    });

    expect(client.product.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(result).toEqual({
      passed: false,
      git_sha: 'a523fc716355654c7672009886ed07d9f9a2177d',
      checked_at: checkedAt.toISOString(),
      summary: {
        active_product_count: 2,
        approved_valid_count: 1,
        blocked_product_count: 1,
      },
      products: [
        {
          product_id: 'active-a',
          passed: true,
          reason_codes: [],
          current_fingerprint: 'current-a',
          approved_fingerprint: 'approved-a',
          review_id: 'review-a',
        },
        {
          product_id: 'active-b',
          passed: false,
          reason_codes: [
            'CATEGORY_NOT_ALLOWED',
            'PRODUCT_SUPPLIER_MISSING',
          ],
          current_fingerprint: 'current-b',
          approved_fingerprint: null,
          review_id: null,
        },
      ],
      rule_versions: {
        category: 'l53-d2-category-v1',
        qualification: 'l53-d2-supplier-qualification-v1',
        fingerprint: 'l53-d2-product-fingerprint-v2',
      },
    });
    const json = JSON.stringify(result);
    for (const secret of [
      '13800138000',
      '320101199001011234',
      'private/qualification.pdf',
      'signature=secret',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('writes one sanitized critical alert for the same failure set', async () => {
    const client = db(['active-b']);
    const input = {
      gitSha: 'a523fc716355654c7672009886ed07d9f9a2177d',
      checkedAt: new Date('2026-07-30T06:00:00.000Z'),
    };

    await evaluateComplianceRelease(client as never, input);
    await evaluateComplianceRelease(client as never, input);

    expect(client.opsAlertLog.upsert).toHaveBeenCalledTimes(2);
    const call = client.opsAlertLog.upsert.mock.calls[0]?.[0];
    const failure = {
      product_ids: ['active-b'],
      reason_codes: [
        'CATEGORY_NOT_ALLOWED',
        'PRODUCT_SUPPLIER_MISSING',
      ],
      rule_versions: {
        category: 'l53-d2-category-v1',
        qualification: 'l53-d2-supplier-qualification-v1',
        fingerprint: 'l53-d2-product-fingerprint-v2',
      },
    };
    expect(call.where.dedupe_key).toBe(
      `l53-d2:l53-d2-category-v1:${failureDigest(failure)}`,
    );
    expect(call.create).toMatchObject({
      alert_type: 'l53_d2_compliance_release_blocked',
      alert_level: 'critical',
      status: 'open',
      title: '生产发布被商品合规门禁阻止',
      message: '1 个在售商品未通过商品合规发布门禁',
      payload: failure,
    });
    expect(JSON.stringify(call)).not.toContain('active product name');
  });

  it('marks evidence generation failed when the critical alert cannot persist', async () => {
    const client = db(['active-b']);
    client.opsAlertLog.upsert.mockRejectedValueOnce(new Error('alert down'));

    const result = await evaluateComplianceRelease(client as never, {
      gitSha: 'sha',
      checkedAt: new Date('2026-07-30T06:00:00.000Z'),
    });

    expect(result.passed).toBe(false);
    expect(result.products[0]?.reason_codes).toEqual([
      'CATEGORY_NOT_ALLOWED',
      'EVIDENCE_GENERATION_FAILED',
      'PRODUCT_SUPPLIER_MISSING',
    ]);
  });

  it('fails closed when facts are missing', async () => {
    const client = db(['missing']);
    compliance.loadCurrentComplianceFacts.mockResolvedValueOnce(null);

    const result = await evaluateComplianceRelease(client as never, {
      gitSha: 'sha',
      checkedAt: new Date('2026-07-30T06:00:00.000Z'),
    });

    expect(result.passed).toBe(false);
    expect(result.products[0]?.reason_codes).toEqual([
      'EVIDENCE_GENERATION_FAILED',
    ]);
  });

  it('fails closed instead of throwing when the database cannot be read', async () => {
    const client = db();
    client.product.findMany.mockRejectedValueOnce(new Error('database down'));

    const result = await evaluateComplianceRelease(client as never, {
      gitSha: 'sha',
      checkedAt: new Date('2026-07-30T06:00:00.000Z'),
    });

    expect(result.passed).toBe(false);
    expect(result.summary).toEqual({
      active_product_count: 0,
      approved_valid_count: 0,
      blocked_product_count: 1,
    });
    expect(result.products[0]?.reason_codes).toEqual([
      'EVIDENCE_GENERATION_FAILED',
    ]);
  });

  it('passes an empty active catalog without creating an alert', async () => {
    const client = db([]);

    const result = await evaluateComplianceRelease(client as never, {
      gitSha: 'sha',
      checkedAt: new Date('2026-07-30T06:00:00.000Z'),
    });

    expect(result.passed).toBe(true);
    expect(result.summary.active_product_count).toBe(0);
    expect(client.opsAlertLog.upsert).not.toHaveBeenCalled();
  });
});
