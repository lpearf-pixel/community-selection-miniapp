import { createHash } from 'node:crypto';

export type AdminWithdrawalAction = 'approve' | 'reject' | 'mark-paid';

export type AdminWithdrawalCommand = {
  expected_version: number;
  idempotency_key: string;
  admin_remark: string;
  manual_reference?: string;
};

type ParseResult =
  | { ok: true; value: AdminWithdrawalCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_WITHDRAWAL_COMMAND';
      message: string;
    };

const COMMON_KEYS = new Set([
  'expected_version',
  'idempotency_key',
  'admin_remark',
]);
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function invalid(): ParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_WITHDRAWAL_COMMAND',
    message: '提现操作命令不合法',
  };
}

function cleanText(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (
    text.length === 0 ||
    text.length > maximumLength ||
    CONTROL_CHARACTER.test(text)
  ) {
    return null;
  }
  return text;
}

export function parseAdminWithdrawalCommand(
  action: AdminWithdrawalAction,
  input: unknown,
): ParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalid();
  }
  const body = input as Record<string, unknown>;
  const allowed = new Set(COMMON_KEYS);
  if (action === 'mark-paid') allowed.add('manual_reference');
  if (
    Object.keys(body).some((key) => !allowed.has(key)) ||
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1 ||
    typeof body.idempotency_key !== 'string' ||
    body.idempotency_key !== body.idempotency_key.trim() ||
    !IDEMPOTENCY_KEY.test(body.idempotency_key)
  ) {
    return invalid();
  }
  const adminRemark = cleanText(body.admin_remark, 500);
  if (!adminRemark) return invalid();

  const manualReference =
    action === 'mark-paid'
      ? cleanText(body.manual_reference, 200)
      : undefined;
  if (action === 'mark-paid' && !manualReference) return invalid();

  return {
    ok: true,
    value: {
      expected_version: Number(body.expected_version),
      idempotency_key: body.idempotency_key,
      admin_remark: adminRemark,
      ...(manualReference ? { manual_reference: manualReference } : {}),
    },
  };
}

export function buildAdminWithdrawalRequestHash(input: {
  withdrawal_id: string;
  action: AdminWithdrawalAction;
  expected_version: number;
  admin_remark: string;
  manual_reference: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: `admin.withdrawal.${input.action}.v1`,
        withdrawal_id: input.withdrawal_id,
        expected_version: input.expected_version,
        admin_remark: input.admin_remark,
        manual_reference: input.manual_reference,
      }),
    )
    .digest('hex');
}
