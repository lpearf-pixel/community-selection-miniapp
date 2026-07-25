import { createHash } from 'node:crypto';

const OPERATION = 'admin.after_sale.refund.execute.v1';
const INVALID_MESSAGE = '退款执行命令不合法';
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ALLOWED_KEYS = new Set([
  'expected_version',
  'idempotency_key',
  'admin_remark',
]);

export type AdminRefundCommand = {
  expected_version: number;
  idempotency_key: string;
  admin_remark: string;
};

export type AdminRefundResult = {
  after_sale_case_id: string;
  order_id: string;
  refund_id: string;
  refund_status: 'success';
  refund_amount_cents: number;
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  remaining_refundable_amount_cents: number;
  order_status: string;
  version: number;
  execution_mode: 'mock';
};

export type AdminRefundCommandParseResult =
  | { ok: true; value: AdminRefundCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_REFUND_COMMAND';
      message: string;
    };

function invalidCommand(): AdminRefundCommandParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_REFUND_COMMAND',
    message: INVALID_MESSAGE,
  };
}

export function parseAdminRefundCommand(
  input: unknown,
): AdminRefundCommandParseResult {
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
    !IDEMPOTENCY_KEY.test(body.idempotency_key) ||
    typeof body.admin_remark !== 'string'
  ) {
    return invalidCommand();
  }

  const adminRemark = body.admin_remark.trim();
  if (
    adminRemark.length === 0 ||
    adminRemark.length > 500 ||
    CONTROL_CHARACTER.test(adminRemark)
  ) {
    return invalidCommand();
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

export function buildAdminRefundRequestHash(input: {
  after_sale_case_id: string;
  order_id: string;
  expected_version: number;
  admin_remark: string;
  approved_refund_cents: number;
  approved_product_refund_cents: number;
  approved_delivery_refund_cents: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: OPERATION,
        after_sale_case_id: input.after_sale_case_id,
        order_id: input.order_id,
        expected_version: input.expected_version,
        admin_remark: input.admin_remark,
        approved_refund_cents: input.approved_refund_cents,
        approved_product_refund_cents:
          input.approved_product_refund_cents,
        approved_delivery_refund_cents:
          input.approved_delivery_refund_cents,
      }),
    )
    .digest('hex');
}
