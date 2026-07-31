const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const SUBMIT_KEYS = new Set([
  'expected_updated_at',
  'expected_fingerprint',
  'idempotency_key',
]);
const REVIEW_KEYS = new Set([
  'decision',
  'expected_status',
  'review_note',
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

function validIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    IDEMPOTENCY_KEY.test(value)
  );
}

function requiredText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export type SubmitProductComplianceGuard =
  | {
      expected_updated_at: Date;
      expected_fingerprint: null;
    }
  | {
      expected_updated_at: null;
      expected_fingerprint: string;
    };

export type SubmitProductComplianceCommand = SubmitProductComplianceGuard & {
  idempotency_key: string;
};

export function hasValidProductComplianceSubmitGuard(input: {
  expected_updated_at: Date | null;
  expected_fingerprint: string | null;
}): input is SubmitProductComplianceGuard {
  return (
    (input.expected_updated_at instanceof Date &&
      !Number.isNaN(input.expected_updated_at.getTime()) &&
      input.expected_fingerprint === null) ||
    (input.expected_updated_at === null &&
      typeof input.expected_fingerprint === 'string' &&
      SHA256.test(input.expected_fingerprint))
  );
}

export function parseSubmitProductComplianceCommand(
  input: unknown,
):
  | { ok: true; value: SubmitProductComplianceCommand }
  | Invalid<'INVALID_PRODUCT_COMPLIANCE_SUBMIT_COMMAND'> {
  const invalid = (): Invalid<'INVALID_PRODUCT_COMPLIANCE_SUBMIT_COMMAND'> => ({
    ok: false,
    code: 'INVALID_PRODUCT_COMPLIANCE_SUBMIT_COMMAND',
    message: '商品合规提交命令不合法',
  });
  const body = record(input);
  if (
    !body ||
    !hasOnlyKeys(body, SUBMIT_KEYS) ||
    !validIdempotencyKey(body.idempotency_key)
  ) {
    return invalid();
  }

  const hasUpdatedAt = Object.hasOwn(body, 'expected_updated_at');
  const hasFingerprint = Object.hasOwn(body, 'expected_fingerprint');
  if (hasUpdatedAt === hasFingerprint) return invalid();

  if (hasUpdatedAt) {
    if (
      typeof body.expected_updated_at !== 'string' ||
      body.expected_updated_at !== body.expected_updated_at.trim()
    ) {
      return invalid();
    }
    const expectedUpdatedAt = new Date(body.expected_updated_at);
    if (Number.isNaN(expectedUpdatedAt.getTime())) return invalid();
    return {
      ok: true,
      value: {
        expected_updated_at: expectedUpdatedAt,
        expected_fingerprint: null,
        idempotency_key: body.idempotency_key,
      },
    };
  }

  if (
    typeof body.expected_fingerprint !== 'string' ||
    !SHA256.test(body.expected_fingerprint)
  ) {
    return invalid();
  }
  return {
    ok: true,
    value: {
      expected_updated_at: null,
      expected_fingerprint: body.expected_fingerprint,
      idempotency_key: body.idempotency_key,
    },
  };
}

export type ReviewProductComplianceCommand = {
  decision: 'approve' | 'reject';
  expected_status: 'submitted';
  review_note: string;
  idempotency_key: string;
};

export function parseReviewProductComplianceCommand(
  input: unknown,
):
  | { ok: true; value: ReviewProductComplianceCommand }
  | Invalid<'INVALID_PRODUCT_COMPLIANCE_REVIEW_COMMAND'> {
  const invalid = (): Invalid<'INVALID_PRODUCT_COMPLIANCE_REVIEW_COMMAND'> => ({
    ok: false,
    code: 'INVALID_PRODUCT_COMPLIANCE_REVIEW_COMMAND',
    message: '商品合规审核命令不合法',
  });
  const body = record(input);
  const reviewNote = body ? requiredText(body.review_note, 500) : null;
  if (
    !body ||
    !hasOnlyKeys(body, REVIEW_KEYS) ||
    (body.decision !== 'approve' && body.decision !== 'reject') ||
    body.expected_status !== 'submitted' ||
    reviewNote === null ||
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
