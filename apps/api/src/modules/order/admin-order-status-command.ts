import { createHash } from 'node:crypto';
import { OrderStatus } from '@prisma/client';

const OPERATION = 'admin.order.status.update.v1';
const INVALID_MESSAGE = '订单状态命令不合法';
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const fulfillmentStatuses = new Set<OrderStatus>([
  OrderStatus.preparing,
  OrderStatus.ready,
  OrderStatus.delivered,
  OrderStatus.completed,
]);

export type AdminOrderStatusCommand = {
  next_status:
    | 'preparing'
    | 'ready'
    | 'delivered'
    | 'completed';
  expected_version: number;
  idempotency_key: string;
};

export type AdminOrderStatusResult = {
  order_id: string;
  order_no: string;
  order_status: AdminOrderStatusCommand['next_status'];
  version: number;
  completed_at: string | null;
};

export type AdminOrderStatusCommandParseResult =
  | { ok: true; value: AdminOrderStatusCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_ORDER_STATUS_COMMAND';
      message: string;
    };

function invalidCommand(): AdminOrderStatusCommandParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_ORDER_STATUS_COMMAND',
    message: INVALID_MESSAGE,
  };
}

export function parseAdminOrderStatusCommand(
  input: unknown,
): AdminOrderStatusCommandParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalidCommand();
  }
  const body = input as Record<string, unknown>;
  if (
    typeof body.next_status !== 'string' ||
    !fulfillmentStatuses.has(body.next_status as OrderStatus) ||
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1 ||
    typeof body.idempotency_key !== 'string' ||
    body.idempotency_key !== body.idempotency_key.trim() ||
    !IDEMPOTENCY_KEY.test(body.idempotency_key)
  ) {
    return invalidCommand();
  }
  return {
    ok: true,
    value: {
      next_status:
        body.next_status as AdminOrderStatusCommand['next_status'],
      expected_version: Number(body.expected_version),
      idempotency_key: body.idempotency_key,
    },
  };
}

export function buildAdminOrderStatusRequestHash(input: {
  order_id: string;
  next_status: AdminOrderStatusCommand['next_status'];
  expected_version: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: OPERATION,
        target_id: input.order_id,
        next_status: input.next_status,
        expected_version: input.expected_version,
      }),
    )
    .digest('hex');
}
