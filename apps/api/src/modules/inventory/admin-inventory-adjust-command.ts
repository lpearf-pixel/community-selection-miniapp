import { createHash } from 'node:crypto';

const OPERATION = 'admin.inventory.product.adjust.v1';
const INVALID_MESSAGE = '库存调整命令不合法';
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ALLOWED_KEYS = new Set([
  'expected_stock',
  'adjust_quantity',
  'reason',
  'idempotency_key',
]);

export type AdminInventoryAdjustCommand = {
  expected_stock: number;
  adjust_quantity: number;
  reason: string;
  idempotency_key: string;
};

export type AdminInventoryAdjustResult = {
  product_id: string;
  stock_before: number;
  stock_after: number;
  adjust_quantity: number;
  stock_unit: string;
};

export type AdminInventoryAdjustCommandParseResult =
  | { ok: true; value: AdminInventoryAdjustCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_INVENTORY_ADJUST_COMMAND';
      message: string;
    };

function invalidCommand(): AdminInventoryAdjustCommandParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_INVENTORY_ADJUST_COMMAND',
    message: INVALID_MESSAGE,
  };
}

export function parseAdminInventoryAdjustCommand(
  input: unknown,
): AdminInventoryAdjustCommandParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalidCommand();
  }

  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !ALLOWED_KEYS.has(key)) ||
    Object.keys(body).length !== ALLOWED_KEYS.size ||
    !Number.isSafeInteger(body.expected_stock) ||
    Number(body.expected_stock) < 0 ||
    !Number.isSafeInteger(body.adjust_quantity) ||
    Number(body.adjust_quantity) === 0 ||
    typeof body.reason !== 'string' ||
    typeof body.idempotency_key !== 'string' ||
    body.idempotency_key !== body.idempotency_key.trim() ||
    !IDEMPOTENCY_KEY.test(body.idempotency_key)
  ) {
    return invalidCommand();
  }

  const expectedStock = Number(body.expected_stock);
  const adjustQuantity = Number(body.adjust_quantity);
  const stockAfter = expectedStock + adjustQuantity;
  const reason = body.reason.trim();
  if (
    !Number.isSafeInteger(stockAfter) ||
    stockAfter < 0 ||
    reason.length === 0 ||
    reason.length > 200 ||
    CONTROL_CHARACTER.test(reason)
  ) {
    return invalidCommand();
  }

  return {
    ok: true,
    value: {
      expected_stock: expectedStock,
      adjust_quantity: adjustQuantity,
      reason,
      idempotency_key: body.idempotency_key,
    },
  };
}

export function buildAdminInventoryAdjustRequestHash(input: {
  product_id: string;
  expected_stock: number;
  adjust_quantity: number;
  reason: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: OPERATION,
        product_id: input.product_id,
        expected_stock: input.expected_stock,
        adjust_quantity: input.adjust_quantity,
        reason: input.reason,
      }),
    )
    .digest('hex');
}
