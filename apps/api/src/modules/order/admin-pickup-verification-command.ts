import { createHash } from 'node:crypto';

const OPERATION = 'admin.order.pickup.verify.v1';
const INVALID_MESSAGE = '自提核销命令不合法';
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ALLOWED_KEYS = new Set([
  'expected_version',
  'idempotency_key',
  'admin_remark',
]);

export type AdminPickupVerificationCommand = {
  expected_version: number;
  idempotency_key: string;
  admin_remark: string | null;
};

export type AdminPickupVerificationResult = {
  order_id: string;
  order_no: string;
  order_status: 'picked';
  version: number;
};

export type AdminPickupVerificationCommandParseResult =
  | { ok: true; value: AdminPickupVerificationCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_PICKUP_VERIFY_COMMAND';
      message: string;
    };

function invalidCommand(): AdminPickupVerificationCommandParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_PICKUP_VERIFY_COMMAND',
    message: INVALID_MESSAGE,
  };
}

export function parseAdminPickupVerificationCommand(
  input: unknown,
): AdminPickupVerificationCommandParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalidCommand();
  }

  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !ALLOWED_KEYS.has(key)) ||
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1 ||
    typeof body.idempotency_key !== 'string' ||
    body.idempotency_key !== body.idempotency_key.trim() ||
    !IDEMPOTENCY_KEY.test(body.idempotency_key)
  ) {
    return invalidCommand();
  }

  let adminRemark: string | null = null;
  if (Object.prototype.hasOwnProperty.call(body, 'admin_remark')) {
    if (
      typeof body.admin_remark !== 'string' ||
      body.admin_remark.length > 500 ||
      body.admin_remark !== body.admin_remark.trim() ||
      CONTROL_CHARACTER.test(body.admin_remark)
    ) {
      return invalidCommand();
    }
    adminRemark = body.admin_remark;
  }

  return {
    ok: true,
    value: {
      expected_version: Number(body.expected_version),
      idempotency_key: body.idempotency_key,
      admin_remark: adminRemark,
    },
  };
}

export function buildAdminPickupVerificationRequestHash(input: {
  order_id: string;
  expected_version: number;
  admin_remark: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: OPERATION,
        target_id: input.order_id,
        expected_version: input.expected_version,
        admin_remark: input.admin_remark,
      }),
    )
    .digest('hex');
}
