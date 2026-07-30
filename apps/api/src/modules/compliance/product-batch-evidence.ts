import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const BUSINESS_SUBJECT_TYPES = new Set([
  'company',
  'cooperative',
  'individual_business',
]);
const PURCHASE_VOUCHER_TYPES = new Set([
  'invoice',
  'receipt',
  'purchase_agreement',
  'farmer_purchase_record',
  'market_ticket',
]);
const INVOICE_EVIDENCE_STATUSES = new Set([
  'available',
  'pending',
  'not_available',
  'not_required',
  'agricultural_purchase_record',
]);
const EVIDENCE_TYPES = new Set([
  'batch_proof',
  'purchase_voucher',
  'quality_certificate',
  'inspection_report',
  'origin_certificate',
]);

export type ProductBatchEvidenceItem = {
  evidence_type: string;
  object_key: string;
  file_sha256: string;
  masked_summary: Record<string, string>;
};

export type ProductBatchEvidenceInput = {
  supplier_subject_type: string;
  supplier_profile_complete: boolean;
  active_qualification_types: string[];
  origin_text: string | null;
  purchase_voucher_type: string | null;
  payment_reference_hash: string | null;
  invoice_evidence_status: string | null;
  evidence: ProductBatchEvidenceItem[];
};

export type ValidatedProductBatchEvidence = Pick<
  ProductBatchEvidenceInput,
  | 'origin_text'
  | 'purchase_voucher_type'
  | 'payment_reference_hash'
  | 'invoice_evidence_status'
  | 'evidence'
>;

export type ProductBatchEvidenceCommandFields = {
  origin_text?: string;
  purchase_voucher_type?: string;
  payment_reference_hash?: string;
  invoice_evidence_status?: string;
  evidence?: ProductBatchEvidenceItem[];
};

export type ProductBatchEvidenceValidation =
  | { ok: true; value: ValidatedProductBatchEvidence }
  | {
      ok: false;
      code: 'INVALID_BATCH_EVIDENCE' | 'BATCH_EVIDENCE_INCOMPLETE';
      reasons: string[];
    };

function isSafeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARACTER.test(value)
  );
}

function isSafeSummary(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length <= 20 &&
    entries.every(
      ([key, text]) =>
        /^[a-z][a-z0-9_]{0,63}$/.test(key) &&
        isSafeText(text, 200) &&
        !/^(?:https?:|data:)/i.test(text),
    )
  );
}

function isValidEvidenceItem(
  value: unknown,
): value is ProductBatchEvidenceItem {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).every((key) =>
      ['evidence_type', 'object_key', 'file_sha256', 'masked_summary'].includes(
        key,
      ),
    ) &&
    typeof item.evidence_type === 'string' &&
    EVIDENCE_TYPES.has(item.evidence_type) &&
    typeof item.object_key === 'string' &&
    item.object_key.startsWith('compliance/') &&
    OBJECT_KEY.test(item.object_key) &&
    !item.object_key.includes('..') &&
    typeof item.file_sha256 === 'string' &&
    SHA256.test(item.file_sha256) &&
    isSafeSummary(item.masked_summary)
  );
}

function invalid(): ProductBatchEvidenceValidation {
  return {
    ok: false,
    code: 'INVALID_BATCH_EVIDENCE',
    reasons: ['INVALID_BATCH_EVIDENCE'],
  };
}

export function parseProductBatchEvidenceCommandFields(
  input: Record<string, unknown>,
): ProductBatchEvidenceCommandFields | null {
  const originText = input.origin_text;
  const voucherType = input.purchase_voucher_type;
  const paymentHash = input.payment_reference_hash;
  const invoiceStatus = input.invoice_evidence_status;
  const evidence = input.evidence;
  if (
    (originText !== undefined && !isSafeText(originText, 500)) ||
    (voucherType !== undefined &&
      (typeof voucherType !== 'string' ||
        !PURCHASE_VOUCHER_TYPES.has(voucherType))) ||
    (paymentHash !== undefined &&
      (typeof paymentHash !== 'string' || !SHA256.test(paymentHash))) ||
    (invoiceStatus !== undefined &&
      (typeof invoiceStatus !== 'string' ||
        !INVOICE_EVIDENCE_STATUSES.has(invoiceStatus))) ||
    (evidence !== undefined &&
      (!Array.isArray(evidence) || !evidence.every(isValidEvidenceItem)))
  ) {
    return null;
  }
  return {
    ...(originText === undefined ? {} : { origin_text: originText }),
    ...(voucherType === undefined
      ? {}
      : { purchase_voucher_type: voucherType }),
    ...(paymentHash === undefined
      ? {}
      : { payment_reference_hash: paymentHash }),
    ...(invoiceStatus === undefined
      ? {}
      : { invoice_evidence_status: invoiceStatus }),
    ...(evidence === undefined ? {} : { evidence }),
  };
}

export function validateProductBatchEvidence(
  input: ProductBatchEvidenceInput,
): ProductBatchEvidenceValidation {
  if (
    input === null ||
    typeof input !== 'object' ||
    typeof input.supplier_subject_type !== 'string' ||
    typeof input.supplier_profile_complete !== 'boolean' ||
    !Array.isArray(input.active_qualification_types) ||
    !input.active_qualification_types.every((value) =>
      isSafeText(value, 100),
    ) ||
    (input.origin_text !== null && !isSafeText(input.origin_text, 500)) ||
    (input.purchase_voucher_type !== null &&
      !PURCHASE_VOUCHER_TYPES.has(input.purchase_voucher_type)) ||
    (input.payment_reference_hash !== null &&
      !SHA256.test(input.payment_reference_hash)) ||
    (input.invoice_evidence_status !== null &&
      !INVOICE_EVIDENCE_STATUSES.has(input.invoice_evidence_status)) ||
    !Array.isArray(input.evidence) ||
    !input.evidence.every(isValidEvidenceItem)
  ) {
    return invalid();
  }

  if (input.supplier_subject_type === 'temporary_source') {
    return {
      ok: false,
      code: 'BATCH_EVIDENCE_INCOMPLETE',
      reasons: ['TEMPORARY_SUPPLIER_NOT_ELIGIBLE'],
    };
  }

  const reasons: string[] = [];
  if (!input.origin_text) reasons.push('BATCH_ORIGIN_MISSING');
  if (!input.purchase_voucher_type) {
    reasons.push('PURCHASE_VOUCHER_TYPE_MISSING');
  }
  if (!input.payment_reference_hash) {
    reasons.push('PAYMENT_REFERENCE_MISSING');
  }
  if (!input.invoice_evidence_status) {
    reasons.push('INVOICE_EVIDENCE_STATUS_MISSING');
  }
  if (
    ['natural_person_producer', 'collector'].includes(
      input.supplier_subject_type,
    )
  ) {
    if (!input.supplier_profile_complete) {
      reasons.push('SUPPLIER_PROFILE_INCOMPLETE');
    }
    if (
      !input.active_qualification_types.includes(
        'agricultural_producer_identity',
      )
    ) {
      reasons.push('SUPPLIER_IDENTITY_QUALIFICATION_MISSING');
    }
    if (!input.evidence.some((item) => item.evidence_type === 'batch_proof')) {
      reasons.push('BATCH_PROOF_MISSING');
    }
  } else if (BUSINESS_SUBJECT_TYPES.has(input.supplier_subject_type)) {
    if (input.active_qualification_types.length === 0) {
      reasons.push('ACTIVE_SUPPLIER_QUALIFICATION_MISSING');
    }
    if (
      !input.evidence.some(
        (item) => item.evidence_type === 'purchase_voucher',
      )
    ) {
      reasons.push('PURCHASE_EVIDENCE_MISSING');
    }
  } else if (input.supplier_subject_type === 'market_stall') {
    if (!input.supplier_profile_complete) {
      reasons.push('SUPPLIER_PROFILE_INCOMPLETE');
    }
    if (
      !input.active_qualification_types.includes('market_stall_registration')
    ) {
      reasons.push('ACTIVE_SUPPLIER_QUALIFICATION_MISSING');
    }
    if (
      !input.evidence.some(
        (item) => item.evidence_type === 'purchase_voucher',
      )
    ) {
      reasons.push('PURCHASE_EVIDENCE_MISSING');
    }
  } else {
    reasons.push('SUPPLIER_SUBJECT_NOT_ELIGIBLE');
  }

  if (reasons.length > 0) {
    return { ok: false, code: 'BATCH_EVIDENCE_INCOMPLETE', reasons };
  }
  return {
    ok: true,
    value: {
      origin_text: input.origin_text,
      purchase_voucher_type: input.purchase_voucher_type,
      payment_reference_hash: input.payment_reference_hash,
      invoice_evidence_status: input.invoice_evidence_status,
      evidence: input.evidence,
    },
  };
}

function evidenceFingerprint(input: {
  evidence_type: string;
  object_key: string | null;
  file_sha256: string | null;
  payment_reference_hash: string | null;
  invoice_evidence_status: string | null;
  masked_summary: Record<string, string>;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 'l53-d2-batch-evidence-v1',
        ...input,
      }),
    )
    .digest('hex');
}

export async function persistProductBatchEvidence(
  tx: Prisma.TransactionClient,
  input: {
    batch_id: string;
    created_by_admin_id: string;
    fields: ProductBatchEvidenceCommandFields;
  },
): Promise<{ evidence_ids: string[]; evidence_hashes: string[] }> {
  const records: Array<{
    evidence_type: string;
    object_key: string | null;
    file_sha256: string | null;
    payment_reference_hash: string | null;
    invoice_evidence_status: string | null;
    masked_summary: Record<string, string>;
  }> = [];
  if (
    input.fields.purchase_voucher_type ||
    input.fields.payment_reference_hash ||
    input.fields.invoice_evidence_status
  ) {
    records.push({
      evidence_type: 'purchase_traceability',
      object_key: null,
      file_sha256: null,
      payment_reference_hash: input.fields.payment_reference_hash ?? null,
      invoice_evidence_status: input.fields.invoice_evidence_status ?? null,
      masked_summary: {
        ...(input.fields.purchase_voucher_type
          ? { purchase_voucher_type: input.fields.purchase_voucher_type }
          : {}),
      },
    });
  }
  for (const evidence of input.fields.evidence ?? []) {
    records.push({
      evidence_type: evidence.evidence_type,
      object_key: evidence.object_key,
      file_sha256: evidence.file_sha256,
      payment_reference_hash: null,
      invoice_evidence_status: null,
      masked_summary: evidence.masked_summary,
    });
  }

  const evidenceIds: string[] = [];
  const evidenceHashes: string[] = [];
  for (const record of records) {
    const fingerprint = evidenceFingerprint(record);
    const created = await tx.productBatchEvidence.create({
      data: {
        batch_id: input.batch_id,
        ...record,
        evidence_fingerprint: fingerprint,
        created_by_admin_id: input.created_by_admin_id,
      },
      select: { id: true, evidence_fingerprint: true },
    });
    evidenceIds.push(created.id);
    evidenceHashes.push(created.evidence_fingerprint);
  }
  return { evidence_ids: evidenceIds, evidence_hashes: evidenceHashes };
}
