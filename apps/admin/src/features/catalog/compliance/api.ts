import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';

export type ComplianceEvidenceType =
  | 'supplier_qualification'
  | 'product_batch_evidence';

export type MaskedSummary = Record<string, string>;

export type ComplianceQualificationSummary = {
  id: string;
  qualification_type: string;
  version: number;
  status: string;
  valid_from: string | null;
  expires_at: string | null;
  masked_summary: MaskedSummary;
};

export type ComplianceBatchEvidenceSummary = {
  id: string;
  evidence_type: string;
  status: string;
  expires_at: string | null;
  masked_summary: MaskedSummary;
};

export type ProductComplianceReviewSummary = {
  id: string;
  status: string;
  effective_valid: boolean;
  review_note: string | null;
};

export type ProductComplianceWorkbenchState = {
  product_id: string;
  product_updated_at: string;
  current_fingerprint: string;
  eligible_for_submission: boolean;
  reason_codes: string[];
  latest_review: ProductComplianceReviewSummary | null;
  supplier: {
    id: string;
    subject_type: string | null;
    status: string;
    source_complete: boolean;
    qualifications: ComplianceQualificationSummary[];
  } | null;
  batch_evidence: ComplianceBatchEvidenceSummary[];
  rule_versions: {
    category: string;
    qualification: string;
    fingerprint: string;
  };
};

export function loadProductCompliance(
  productId: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<ProductComplianceWorkbenchState> {
  return request<ProductComplianceWorkbenchState>(
    `/api/admin/products/${productId}/compliance`,
    { signal },
  );
}

export function submitProductCompliance(
  productId: string,
  expectedFingerprint: string,
  idempotencyKey: string,
  request: JsonRequester = adminJsonRequest,
): Promise<ProductComplianceReviewSummary> {
  return request<ProductComplianceReviewSummary>(
    `/api/admin/products/${productId}/compliance/submit`,
    {
      method: 'POST',
      body: JSON.stringify({
        expected_fingerprint: expectedFingerprint,
        idempotency_key: idempotencyKey,
      }),
    },
  );
}

export function reviewProductCompliance(
  reviewId: string,
  decision: 'approve' | 'reject',
  reviewNote: string,
  idempotencyKey: string,
  request: JsonRequester = adminJsonRequest,
): Promise<ProductComplianceReviewSummary> {
  return request<ProductComplianceReviewSummary>(
    `/api/admin/product-compliance-reviews/${reviewId}/review`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision,
        expected_status: 'submitted',
        review_note: reviewNote,
        idempotency_key: idempotencyKey,
      }),
    },
  );
}

export function accessComplianceEvidence(
  evidenceType: ComplianceEvidenceType,
  evidenceId: string,
  purpose: string,
  request: JsonRequester = adminJsonRequest,
): Promise<never> {
  return request<never>(
    `/api/admin/compliance-evidence/${evidenceType}/${evidenceId}/access`,
    {
      method: 'POST',
      body: JSON.stringify({ purpose }),
    },
  );
}
