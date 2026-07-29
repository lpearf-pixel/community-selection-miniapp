import { describe, expect, it } from 'vitest';
import {
  parseReviewSupplierQualificationCommand,
  parseRevokeSupplierQualificationCommand,
  parseSubmitSupplierQualificationCommand,
  parseSupplierSubjectProfile,
} from './supplier-qualification-command.js';

const idempotencyKey = 'supplier-qualification-key-001';

describe('L53-D2 supplier subject profile command', () => {
  it.each([
    'company',
    'cooperative',
    'individual_business',
    'natural_person_producer',
    'market_stall',
    'collector',
    'temporary_source',
  ])('accepts supported subject type %s with its required source fields', (subjectType) => {
    const result = parseSupplierSubjectProfile({
      subject_type: subjectType,
      source_address:
        subjectType === 'natural_person_producer' ||
        subjectType === 'collector'
          ? '南京市江宁区生产基地'
          : null,
      market_name: subjectType === 'market_stall' ? '南京农副产品物流中心' : null,
      stall_no: subjectType === 'market_stall' ? 'A-108' : null,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects a natural-person producer without a production address', () => {
    expect(
      parseSupplierSubjectProfile({
        subject_type: 'natural_person_producer',
        source_address: null,
        market_name: null,
        stall_no: null,
      }),
    ).toEqual({
      ok: false,
      code: 'INVALID_SUPPLIER_SUBJECT_PROFILE',
      message: '供应商主体档案不合法',
    });
  });

  it('requires both market name and stall number for a market stall', () => {
    expect(
      parseSupplierSubjectProfile({
        subject_type: 'market_stall',
        source_address: null,
        market_name: '南京农副产品物流中心',
        stall_no: null,
      }),
    ).toMatchObject({ ok: false });
  });

  it('rejects unknown and unexpected profile fields', () => {
    expect(
      parseSupplierSubjectProfile({
        subject_type: 'unlicensed',
        source_address: '南京',
        market_name: null,
        stall_no: null,
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseSupplierSubjectProfile({
        subject_type: 'company',
        source_address: null,
        market_name: null,
        stall_no: null,
        identity_number: '320100000000000000',
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('L53-D2 supplier qualification submit command', () => {
  const valid = () => ({
    qualification_type: 'business_license',
    object_key: 'compliance/suppliers/supplier-1/license-v1.pdf',
    file_sha256: 'a'.repeat(64),
    issued_at: '2026-01-01T00:00:00.000Z',
    valid_from: '2026-01-01T00:00:00.000Z',
    expires_at: '2027-01-01T00:00:00.000Z',
    masked_summary: {
      holder: '南***公司',
      license: '9132********1234',
    },
    idempotency_key: idempotencyKey,
  });

  it('normalizes a controlled evidence reference and dates', () => {
    expect(parseSubmitSupplierQualificationCommand(valid())).toEqual({
      ok: true,
      value: {
        ...valid(),
        issued_at: new Date('2026-01-01T00:00:00.000Z'),
        valid_from: new Date('2026-01-01T00:00:00.000Z'),
        expires_at: new Date('2027-01-01T00:00:00.000Z'),
      },
    });
  });

  it.each([
    'https://storage.example.com/license.pdf',
    'compliance/license.pdf?X-Amz-Signature=secret',
    'data:application/pdf;base64,AAAA',
    '/compliance/license.pdf',
    'compliance/../license.pdf',
  ])('rejects public, signed, embedded, or traversal reference %s', (objectKey) => {
    expect(
      parseSubmitSupplierQualificationCommand({
        ...valid(),
        object_key: objectKey,
      }),
    ).toMatchObject({ ok: false });
  });

  it.each(['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)])(
    'rejects non-lowercase-SHA-256 digest %s',
    (fileSha256) => {
      expect(
        parseSubmitSupplierQualificationCommand({
          ...valid(),
          file_sha256: fileSha256,
        }),
      ).toMatchObject({ ok: false });
    },
  );

  it('rejects expiry before validity', () => {
    expect(
      parseSubmitSupplierQualificationCommand({
        ...valid(),
        valid_from: '2027-01-01T00:00:00.000Z',
        expires_at: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ ok: false });
  });

  it.each([
    { file_content: 'raw-pdf-body' },
    { raw_identity_number: '320100000000000000' },
    { auto_approve: true },
  ])('rejects raw evidence or automatic approval field %o', (extra) => {
    expect(
      parseSubmitSupplierQualificationCommand({ ...valid(), ...extra }),
    ).toMatchObject({ ok: false });
  });
});

describe('L53-D2 supplier qualification decision commands', () => {
  it.each(['approve', 'reject'] as const)(
    'accepts the explicit %s review action',
    (decision) => {
      expect(
        parseReviewSupplierQualificationCommand({
          decision,
          expected_status: 'submitted',
          review_note: decision === 'approve' ? '资料核验通过' : '证件影像不完整',
          idempotency_key: `${idempotencyKey}-${decision}`,
        }),
      ).toMatchObject({
        ok: true,
        value: { decision, expected_status: 'submitted' },
      });
    },
  );

  it('rejects a review without a reason or with an automatic action', () => {
    expect(
      parseReviewSupplierQualificationCommand({
        decision: 'approve',
        expected_status: 'submitted',
        review_note: ' ',
        idempotency_key: idempotencyKey,
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseReviewSupplierQualificationCommand({
        decision: 'approve',
        expected_status: 'submitted',
        review_note: '资料核验通过',
        idempotency_key: idempotencyKey,
        auto_approve: true,
      }),
    ).toMatchObject({ ok: false });
  });

  it('requires an approved expected state and reason for revocation', () => {
    expect(
      parseRevokeSupplierQualificationCommand({
        expected_status: 'approved',
        reason: '发证机构确认撤销',
        idempotency_key: `${idempotencyKey}-revoke`,
      }),
    ).toEqual({
      ok: true,
      value: {
        expected_status: 'approved',
        reason: '发证机构确认撤销',
        idempotency_key: `${idempotencyKey}-revoke`,
      },
    });
    expect(
      parseRevokeSupplierQualificationCommand({
        expected_status: 'submitted',
        reason: '发证机构确认撤销',
        idempotency_key: `${idempotencyKey}-revoke`,
      }),
    ).toMatchObject({ ok: false });
  });
});
