const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;

const SUBJECT_TYPES = new Set([
  'company',
  'cooperative',
  'individual_business',
  'natural_person_producer',
  'market_stall',
  'collector',
  'temporary_source',
]);
const QUALIFICATION_TYPES = new Set([
  'business_license',
  'food_business_license',
  'agricultural_producer_identity',
  'origin_certificate',
  'quality_certificate',
  'market_stall_registration',
  'purchase_agreement',
]);
const SUBJECT_KEYS = new Set([
  'subject_type',
  'source_address',
  'market_name',
  'stall_no',
]);
const SUBMIT_KEYS = new Set([
  'qualification_type',
  'object_key',
  'file_sha256',
  'issued_at',
  'valid_from',
  'expires_at',
  'masked_summary',
  'idempotency_key',
]);
const REVIEW_KEYS = new Set([
  'decision',
  'expected_status',
  'review_note',
  'idempotency_key',
]);
const REVOKE_KEYS = new Set([
  'expected_status',
  'reason',
  'idempotency_key',
]);

type Invalid<Code extends string> = {
  ok: false;
  code: Code;
  message: string;
};

function record(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(body: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(body).every((key) => allowed.has(key));
}

function optionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function validIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    IDEMPOTENCY_KEY.test(value)
  );
}

function optionalDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') {
    return value === undefined ? undefined : null;
  }
  if (typeof value !== 'string' || value !== value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function maskedSummary(value: unknown): Record<string, string> | null {
  const body = record(value);
  if (!body || Object.keys(body).length > 20) return null;
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) return null;
    const text = optionalText(raw, 200);
    if (typeof text !== 'string') return null;
    if (/^(?:https?:|data:)/i.test(text)) return null;
    normalized[key] = text;
  }
  return normalized;
}

export type SupplierSubjectProfile = {
  subject_type: string;
  source_address: string | null;
  market_name: string | null;
  stall_no: string | null;
};

export function parseSupplierSubjectProfile(
  input: unknown,
):
  | { ok: true; value: SupplierSubjectProfile }
  | Invalid<'INVALID_SUPPLIER_SUBJECT_PROFILE'> {
  const body = record(input);
  const invalid = (): Invalid<'INVALID_SUPPLIER_SUBJECT_PROFILE'> => ({
    ok: false,
    code: 'INVALID_SUPPLIER_SUBJECT_PROFILE',
    message: '供应商主体档案不合法',
  });
  if (
    !body ||
    !hasOnlyKeys(body, SUBJECT_KEYS) ||
    typeof body.subject_type !== 'string' ||
    !SUBJECT_TYPES.has(body.subject_type)
  ) {
    return invalid();
  }
  const sourceAddress = optionalText(body.source_address, 500);
  const marketName = optionalText(body.market_name, 200);
  const stallNo = optionalText(body.stall_no, 100);
  if (
    sourceAddress === undefined ||
    marketName === undefined ||
    stallNo === undefined ||
    (['natural_person_producer', 'collector'].includes(body.subject_type) &&
      sourceAddress === null) ||
    (body.subject_type === 'market_stall' &&
      (marketName === null || stallNo === null))
  ) {
    return invalid();
  }
  return {
    ok: true,
    value: {
      subject_type: body.subject_type,
      source_address: sourceAddress,
      market_name: marketName,
      stall_no: stallNo,
    },
  };
}

export type SubmitSupplierQualificationCommand = {
  qualification_type: string;
  object_key: string;
  file_sha256: string;
  issued_at: Date | null;
  valid_from: Date | null;
  expires_at: Date | null;
  masked_summary: Record<string, string>;
  idempotency_key: string;
};

export function parseSubmitSupplierQualificationCommand(
  input: unknown,
):
  | { ok: true; value: SubmitSupplierQualificationCommand }
  | Invalid<'INVALID_SUPPLIER_QUALIFICATION_SUBMIT_COMMAND'> {
  const body = record(input);
  const invalid =
    (): Invalid<'INVALID_SUPPLIER_QUALIFICATION_SUBMIT_COMMAND'> => ({
      ok: false,
      code: 'INVALID_SUPPLIER_QUALIFICATION_SUBMIT_COMMAND',
      message: '供应商资质提交命令不合法',
    });
  if (
    !body ||
    !hasOnlyKeys(body, SUBMIT_KEYS) ||
    typeof body.qualification_type !== 'string' ||
    !QUALIFICATION_TYPES.has(body.qualification_type) ||
    typeof body.object_key !== 'string' ||
    body.object_key !== body.object_key.trim() ||
    !body.object_key.startsWith('compliance/') ||
    !OBJECT_KEY.test(body.object_key) ||
    body.object_key.includes('..') ||
    typeof body.file_sha256 !== 'string' ||
    !SHA256.test(body.file_sha256) ||
    !validIdempotencyKey(body.idempotency_key)
  ) {
    return invalid();
  }
  const issuedAt = optionalDate(body.issued_at);
  const validFrom = optionalDate(body.valid_from);
  const expiresAt = optionalDate(body.expires_at);
  const summary = maskedSummary(body.masked_summary);
  if (
    issuedAt === undefined ||
    validFrom === undefined ||
    expiresAt === undefined ||
    !summary ||
    (validFrom && expiresAt && expiresAt <= validFrom)
  ) {
    return invalid();
  }
  return {
    ok: true,
    value: {
      qualification_type: body.qualification_type,
      object_key: body.object_key,
      file_sha256: body.file_sha256,
      issued_at: issuedAt,
      valid_from: validFrom,
      expires_at: expiresAt,
      masked_summary: summary,
      idempotency_key: body.idempotency_key,
    },
  };
}

export type ReviewSupplierQualificationCommand = {
  decision: 'approve' | 'reject';
  expected_status: 'submitted';
  review_note: string;
  idempotency_key: string;
};

export function parseReviewSupplierQualificationCommand(
  input: unknown,
):
  | { ok: true; value: ReviewSupplierQualificationCommand }
  | Invalid<'INVALID_SUPPLIER_QUALIFICATION_REVIEW_COMMAND'> {
  const body = record(input);
  const invalid =
    (): Invalid<'INVALID_SUPPLIER_QUALIFICATION_REVIEW_COMMAND'> => ({
      ok: false,
      code: 'INVALID_SUPPLIER_QUALIFICATION_REVIEW_COMMAND',
      message: '供应商资质审核命令不合法',
    });
  const reviewNote = body ? optionalText(body.review_note, 500) : undefined;
  if (
    !body ||
    !hasOnlyKeys(body, REVIEW_KEYS) ||
    (body.decision !== 'approve' && body.decision !== 'reject') ||
    body.expected_status !== 'submitted' ||
    typeof reviewNote !== 'string' ||
    !validIdempotencyKey(body.idempotency_key)
  ) {
    return invalid();
  }
  return {
    ok: true,
    value: {
      decision: body.decision,
      expected_status: 'submitted',
      review_note: reviewNote,
      idempotency_key: body.idempotency_key,
    },
  };
}

export type RevokeSupplierQualificationCommand = {
  expected_status: 'approved';
  reason: string;
  idempotency_key: string;
};

export function parseRevokeSupplierQualificationCommand(
  input: unknown,
):
  | { ok: true; value: RevokeSupplierQualificationCommand }
  | Invalid<'INVALID_SUPPLIER_QUALIFICATION_REVOKE_COMMAND'> {
  const body = record(input);
  const invalid =
    (): Invalid<'INVALID_SUPPLIER_QUALIFICATION_REVOKE_COMMAND'> => ({
      ok: false,
      code: 'INVALID_SUPPLIER_QUALIFICATION_REVOKE_COMMAND',
      message: '供应商资质撤销命令不合法',
    });
  const reason = body ? optionalText(body.reason, 500) : undefined;
  if (
    !body ||
    !hasOnlyKeys(body, REVOKE_KEYS) ||
    body.expected_status !== 'approved' ||
    typeof reason !== 'string' ||
    !validIdempotencyKey(body.idempotency_key)
  ) {
    return invalid();
  }
  return {
    ok: true,
    value: {
      expected_status: 'approved',
      reason,
      idempotency_key: body.idempotency_key,
    },
  };
}
