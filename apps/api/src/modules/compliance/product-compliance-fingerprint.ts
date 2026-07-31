import { createHash } from 'node:crypto';

export const PRODUCT_COMPLIANCE_FINGERPRINT_VERSION =
  'l53-d2-product-fingerprint-v2';

export type ProductComplianceFingerprintInput = {
  name: string;
  description: string | null;
  category_code: string | null;
  supplier_id: string | null;
  supplier_subject_type: string | null;
  supplier_profile_fingerprint: string | null;
  supplier_profile_version: number | null;
  origin_text: string | null;
  qualification_hashes: string[];
  batch_evidence_hashes: string[];
  labels: string[];
  cover_image: string | null;
  images: string[];
};

function normalizedText(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizedList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function buildProductComplianceFingerprint(
  input: ProductComplianceFingerprintInput,
) {
  const canonical = {
    version: PRODUCT_COMPLIANCE_FINGERPRINT_VERSION,
    name: input.name.trim(),
    description: normalizedText(input.description),
    category_code: normalizedText(input.category_code),
    supplier_id: normalizedText(input.supplier_id),
    supplier_subject_type: normalizedText(input.supplier_subject_type),
    supplier_profile_fingerprint: normalizedText(
      input.supplier_profile_fingerprint,
    ),
    supplier_profile_version: input.supplier_profile_version,
    origin_text: normalizedText(input.origin_text),
    qualification_hashes: normalizedList(input.qualification_hashes),
    batch_evidence_hashes: normalizedList(input.batch_evidence_hashes),
    labels: normalizedList(input.labels),
    cover_image: normalizedText(input.cover_image),
    images: normalizedList(input.images),
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}
