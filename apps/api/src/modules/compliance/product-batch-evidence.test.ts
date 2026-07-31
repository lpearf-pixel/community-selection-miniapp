import { describe, expect, it } from 'vitest';
import { validateProductBatchEvidence } from './product-batch-evidence.js';

const hash = (character: string) => character.repeat(64);

const batchProof = {
  evidence_type: 'batch_proof',
  object_key: 'compliance/batches/batch-proof.pdf',
  file_sha256: hash('a'),
  masked_summary: { document_no: '***1234' },
};

describe('L53-D2 product batch evidence eligibility', () => {
  it('accepts a complete natural-person producer traceability package', () => {
    expect(
      validateProductBatchEvidence({
        supplier_subject_type: 'natural_person_producer',
        supplier_profile_complete: true,
        active_qualification_types: ['agricultural_producer_identity'],
        origin_text: '南京市江宁区',
        purchase_voucher_type: 'farmer_purchase_record',
        payment_reference_hash: hash('b'),
        invoice_evidence_status: 'agricultural_purchase_record',
        evidence: [batchProof],
      }),
    ).toEqual({
      ok: true,
      value: {
        origin_text: '南京市江宁区',
        purchase_voucher_type: 'farmer_purchase_record',
        payment_reference_hash: hash('b'),
        invoice_evidence_status: 'agricultural_purchase_record',
        evidence: [batchProof],
      },
    });
  });

  it.each([
    [
      { supplier_profile_complete: false },
      ['SUPPLIER_PROFILE_INCOMPLETE'],
    ],
    [
      { active_qualification_types: [] },
      ['SUPPLIER_IDENTITY_QUALIFICATION_MISSING'],
    ],
    [{ origin_text: null }, ['BATCH_ORIGIN_MISSING']],
    [{ payment_reference_hash: null }, ['PAYMENT_REFERENCE_MISSING']],
    [{ evidence: [] }, ['BATCH_PROOF_MISSING']],
  ])(
    'rejects an incomplete natural-person package: %j',
    (changes, reasons) => {
      expect(
        validateProductBatchEvidence({
          supplier_subject_type: 'natural_person_producer',
          supplier_profile_complete: true,
          active_qualification_types: ['agricultural_producer_identity'],
          origin_text: '南京市江宁区',
          purchase_voucher_type: 'farmer_purchase_record',
          payment_reference_hash: hash('b'),
          invoice_evidence_status: 'agricultural_purchase_record',
          evidence: [batchProof],
          ...changes,
        }),
      ).toEqual({ ok: false, code: 'BATCH_EVIDENCE_INCOMPLETE', reasons });
    },
  );

  it.each(['company', 'cooperative', 'individual_business'])(
    'requires an active business qualification and purchase evidence for %s',
    (supplier_subject_type) => {
      const base = {
        supplier_subject_type,
        supplier_profile_complete: true,
        active_qualification_types: ['business_license'],
        origin_text: '南京市',
        purchase_voucher_type: 'invoice',
        payment_reference_hash: hash('c'),
        invoice_evidence_status: 'available',
        evidence: [
          {
            ...batchProof,
            evidence_type: 'purchase_voucher',
          },
        ],
      };

      expect(validateProductBatchEvidence(base)).toMatchObject({ ok: true });
      expect(
        validateProductBatchEvidence({
          ...base,
          active_qualification_types: [],
        }),
      ).toEqual({
        ok: false,
        code: 'BATCH_EVIDENCE_INCOMPLETE',
        reasons: ['ACTIVE_SUPPLIER_QUALIFICATION_MISSING'],
      });
      expect(
        validateProductBatchEvidence({ ...base, evidence: [] }),
      ).toEqual({
        ok: false,
        code: 'BATCH_EVIDENCE_INCOMPLETE',
        reasons: ['PURCHASE_EVIDENCE_MISSING'],
      });
    },
  );

  it('requires shared origin, voucher, payment, and invoice facts for a business supplier', () => {
    expect(
      validateProductBatchEvidence({
        supplier_subject_type: 'company',
        supplier_profile_complete: true,
        active_qualification_types: ['business_license'],
        origin_text: null,
        purchase_voucher_type: null,
        payment_reference_hash: null,
        invoice_evidence_status: null,
        evidence: [
          {
            ...batchProof,
            evidence_type: 'purchase_voucher',
          },
        ],
      }),
    ).toEqual({
      ok: false,
      code: 'BATCH_EVIDENCE_INCOMPLETE',
      reasons: [
        'BATCH_ORIGIN_MISSING',
        'PURCHASE_VOUCHER_TYPE_MISSING',
        'PAYMENT_REFERENCE_MISSING',
        'INVOICE_EVIDENCE_STATUS_MISSING',
      ],
    });
  });

  it('accepts a complete market-stall package with active registration', () => {
    expect(
      validateProductBatchEvidence({
        supplier_subject_type: 'market_stall',
        supplier_profile_complete: true,
        active_qualification_types: ['market_stall_registration'],
        origin_text: '南京农副产品物流中心',
        purchase_voucher_type: 'market_ticket',
        payment_reference_hash: hash('e'),
        invoice_evidence_status: 'not_available',
        evidence: [
          {
            ...batchProof,
            evidence_type: 'purchase_voucher',
          },
        ],
      }),
    ).toMatchObject({ ok: true });
  });

  it('always rejects a temporary source for product approval', () => {
    expect(
      validateProductBatchEvidence({
        supplier_subject_type: 'temporary_source',
        supplier_profile_complete: true,
        active_qualification_types: ['business_license'],
        origin_text: '南京市',
        purchase_voucher_type: 'invoice',
        payment_reference_hash: hash('d'),
        invoice_evidence_status: 'available',
        evidence: [{ ...batchProof, evidence_type: 'purchase_voucher' }],
      }),
    ).toEqual({
      ok: false,
      code: 'BATCH_EVIDENCE_INCOMPLETE',
      reasons: ['TEMPORARY_SUPPLIER_NOT_ELIGIBLE'],
    });
  });

  it.each([
    {
      evidence: [{ ...batchProof, object_key: 'https://files.test/proof.pdf' }],
    },
    {
      evidence: [{ ...batchProof, object_key: 'compliance/../secret.pdf' }],
    },
    {
      evidence: [{ ...batchProof, file_sha256: 'not-a-sha256' }],
    },
    {
      evidence: [
        {
          ...batchProof,
          masked_summary: { raw_url: 'https://files.test/proof.pdf' },
        },
      ],
    },
    { payment_reference_hash: 'payment-raw-reference' },
  ])('rejects unsafe or unhashed evidence input: %j', (changes) => {
    expect(
      validateProductBatchEvidence({
        supplier_subject_type: 'natural_person_producer',
        supplier_profile_complete: true,
        active_qualification_types: ['agricultural_producer_identity'],
        origin_text: '南京市江宁区',
        purchase_voucher_type: 'farmer_purchase_record',
        payment_reference_hash: hash('b'),
        invoice_evidence_status: 'agricultural_purchase_record',
        evidence: [batchProof],
        ...changes,
      }),
    ).toEqual({
      ok: false,
      code: 'INVALID_BATCH_EVIDENCE',
      reasons: ['INVALID_BATCH_EVIDENCE'],
    });
  });
});
