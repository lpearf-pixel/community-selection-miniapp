import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  isCurrentComplianceRequest,
  ProductComplianceWorkbenchView,
  reviewSessionKey,
  type ProductComplianceWorkbenchState,
} from './ProductCompliancePanel';

const state: ProductComplianceWorkbenchState = {
  product_id: 'product-1',
  product_updated_at: '2026-07-29T10:00:00.000Z',
  current_fingerprint: 'a'.repeat(64),
  eligible_for_submission: false,
  reason_codes: [
    'PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED',
    'SUPPLIER_QUALIFICATION_INVALID',
  ],
  latest_review: {
    id: 'review-1',
    status: 'approved',
    effective_valid: false,
    review_note: '首次审核通过',
  },
  supplier: {
    id: 'supplier-1',
    subject_type: 'individual_business',
    status: 'active',
    source_complete: true,
    qualifications: [
      {
        id: 'qualification-1',
        qualification_type: 'business_license',
        version: 2,
        status: 'approved',
        valid_from: '2026-01-01T00:00:00.000Z',
        expires_at: '2027-01-01T00:00:00.000Z',
        masked_summary: { license_no_masked: '32***********8' },
      },
    ],
  },
  batch_evidence: [
    {
      id: 'evidence-1',
      evidence_type: 'purchase_voucher',
      status: 'active',
      expires_at: null,
      masked_summary: { voucher_no_masked: 'PO-****-88' },
    },
  ],
  rule_versions: {
    category: 'l53-d2-category-v1',
    qualification: 'l53-d2-supplier-qualification-v1',
    fingerprint: 'l53-d2-product-fingerprint-v2',
  },
};

describe('ProductComplianceWorkbenchView', () => {
  it('shows dynamic invalidation, supplier qualification and masked evidence', () => {
    const html = renderToStaticMarkup(
      <ProductComplianceWorkbenchView
        state={state}
        busy={false}
        onSubmit={() => undefined}
        onReview={() => undefined}
        onAccessEvidence={() => undefined}
      />,
    );

    expect(html).toContain('商品合规审核');
    expect(html).toContain('PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED');
    expect(html).toContain('SUPPLIER_QUALIFICATION_INVALID');
    expect(html).toContain('个体工商户');
    expect(html).toContain('2027-01-01');
    expect(html).toContain('32***********8');
    expect(html).toContain('PO-****-88');
    expect(html).toContain('提交审核');
    expect(html).toContain('通过');
    expect(html).toMatch(/驳\s*回/);
  });

  it('never renders controlled object references or raw URLs', () => {
    const unsafe = structuredClone(state);
    unsafe.supplier!.qualifications[0]!.masked_summary = {
      object_key: 'compliance/private/license.jpg',
      raw_url: 'https://storage.example/signed',
      id_card_no: '320101199001011234',
      bank_account: '6222020202020202020',
      license_no_masked: '32*0101*1990*0101*1234',
      holder_name_masked: '南***公司',
    };
    const html = renderToStaticMarkup(
      <ProductComplianceWorkbenchView
        state={unsafe}
        busy={false}
        onSubmit={() => undefined}
        onReview={() => undefined}
        onAccessEvidence={() => undefined}
      />,
    );
    expect(html).toContain('南***公司');
    expect(html).not.toContain('compliance/private');
    expect(html).not.toContain('storage.example');
    expect(html).not.toContain('object_key');
    expect(html).not.toContain('raw_url');
    expect(html).not.toContain('320101199001011234');
    expect(html).not.toContain('6222020202020202020');
    expect(html).not.toContain('32*0101*1990*0101*1234');
  });

  it('keeps submit and review as separate confirmed actions with a note', () => {
    const source = renderToStaticMarkup(
      <ProductComplianceWorkbenchView
        state={{ ...state, eligible_for_submission: true }}
        busy={false}
        onSubmit={() => undefined}
        onReview={() => undefined}
        onAccessEvidence={() => undefined}
      />,
    );
    expect(source).toContain('提交审核');
    expect(source).toContain('审核说明');
    expect(source).not.toContain('自动通过');
  });

  it('keeps the workbench visible when evidence access is unavailable', () => {
    const html = renderToStaticMarkup(
      <ProductComplianceWorkbenchView
        state={state}
        busy={false}
        actionError="EVIDENCE_DOWNLOAD_UNAVAILABLE"
        onSubmit={() => undefined}
        onReview={() => undefined}
        onAccessEvidence={() => undefined}
      />,
    );
    expect(html).toContain('EVIDENCE_DOWNLOAD_UNAVAILABLE');
    expect(html).toContain('商品合规审核');
    expect(html).toContain('当前指纹');
    expect(html).toContain('提交审核');
  });

  it('separates stale product responses and review-note sessions', () => {
    expect(isCurrentComplianceRequest('product-b', 'product-a')).toBe(false);
    expect(isCurrentComplianceRequest('product-b', 'product-b')).toBe(true);
    expect(reviewSessionKey(state)).toBe('product-1:review-1');
    expect(
      reviewSessionKey({
        ...state,
        product_id: 'product-2',
      }),
    ).toBe('product-2:review-1');
    expect(
      reviewSessionKey({
        ...state,
        latest_review: { ...state.latest_review!, id: 'review-2' },
      }),
    ).toBe('product-1:review-2');
  });
});
