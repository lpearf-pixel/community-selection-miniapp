import { describe, expect, it } from 'vitest';
import {
  buildProductComplianceFingerprint,
  type ProductComplianceFingerprintInput,
} from './product-compliance-fingerprint.js';

const base = (): ProductComplianceFingerprintInput => ({
  name: '有机番茄',
  description: '当天采摘',
  category_code: 'vegetable',
  supplier_id: 'supplier-1',
  origin_text: '南京市江宁区',
  qualification_hashes: ['qualification-b', 'qualification-a'],
  batch_evidence_hashes: ['batch-b', 'batch-a'],
  labels: ['当季', '有机'],
  cover_image: 'images/tomato-cover.jpg',
  images: ['images/tomato-b.jpg', 'images/tomato-a.jpg'],
});

describe('L53-D2 product compliance fingerprint', () => {
  it.each([
    ['name', '有机小番茄'],
    ['description', '次日采摘'],
    ['category_code', 'fruit'],
    ['supplier_id', 'supplier-2'],
    ['origin_text', '南京市六合区'],
    ['cover_image', 'images/tomato-cover-v2.jpg'],
  ] as const)('changes when compliance field %s changes', (field, value) => {
    expect(
      buildProductComplianceFingerprint({ ...base(), [field]: value }),
    ).not.toBe(buildProductComplianceFingerprint(base()));
  });

  it.each([
    ['qualification_hashes', ['qualification-c']],
    ['batch_evidence_hashes', ['batch-c']],
    ['labels', ['当季', '精选']],
    ['images', ['images/tomato-c.jpg']],
  ] as const)('changes when compliance collection %s changes', (field, value) => {
    expect(
      buildProductComplianceFingerprint({ ...base(), [field]: value }),
    ).not.toBe(buildProductComplianceFingerprint(base()));
  });

  it('is stable across collection order and surrounding text whitespace', () => {
    expect(
      buildProductComplianceFingerprint({
        ...base(),
        name: '  有机番茄  ',
        description: ' 当天采摘 ',
        origin_text: ' 南京市江宁区 ',
        qualification_hashes: ['qualification-a', 'qualification-b'],
        batch_evidence_hashes: ['batch-a', 'batch-b'],
        labels: ['有机', '当季'],
        images: ['images/tomato-a.jpg', 'images/tomato-b.jpg'],
      }),
    ).toBe(buildProductComplianceFingerprint(base()));
  });

  it('distinguishes null from a meaningful value and normalizes blank text to null', () => {
    const withoutDescription = buildProductComplianceFingerprint({
      ...base(),
      description: null,
    });
    expect(
      buildProductComplianceFingerprint({ ...base(), description: '   ' }),
    ).toBe(withoutDescription);
    expect(withoutDescription).not.toBe(buildProductComplianceFingerprint(base()));
  });

  it('does not accept operational fields in the fingerprint input', () => {
    const operationallyChanged = {
      ...base(),
      price_cents: 999,
      cost_price_cents: 500,
      stock: 1,
      sales: 88,
      sort_order: 20,
      promotion_status: 'active',
    };
    expect(buildProductComplianceFingerprint(operationallyChanged)).toBe(
      buildProductComplianceFingerprint(base()),
    );
  });

  it('returns a lowercase SHA-256 digest', () => {
    expect(buildProductComplianceFingerprint(base())).toMatch(/^[a-f0-9]{64}$/);
  });
});
