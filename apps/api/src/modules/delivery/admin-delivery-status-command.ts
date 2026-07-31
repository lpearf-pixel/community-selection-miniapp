import { createHash } from 'node:crypto';
import type { DeliveryFulfillmentStatus } from '@prisma/client';

const OPERATION = 'admin.delivery.status.update.v1';
const INVALID_MESSAGE = '配送状态命令不合法';
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const statuses = new Set<DeliveryFulfillmentStatus>([
  'pending_dispatch',
  'delivering',
  'delivered',
  'exception',
]);
const allowedKeys = new Set([
  'delivery_status',
  'expected_version',
  'idempotency_key',
  'remark',
]);

export type AdminDeliveryStatusCommand = {
  delivery_status: DeliveryFulfillmentStatus;
  expected_version: number;
  idempotency_key: string;
  remark?: string;
};

export type AdminDeliveryStatusResult = {
  order_id: string;
  order_no: string;
  delivery_status: DeliveryFulfillmentStatus;
  order_status: string;
  version: number;
  allowed_next_statuses: DeliveryFulfillmentStatus[];
};

export type AdminDeliveryStatusCommandParseResult =
  | { ok: true; value: AdminDeliveryStatusCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_DELIVERY_STATUS_COMMAND';
      message: string;
    };

function invalid(message = INVALID_MESSAGE): AdminDeliveryStatusCommandParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_DELIVERY_STATUS_COMMAND',
    message,
  };
}

export function parseAdminDeliveryStatusCommand(
  input: unknown,
): AdminDeliveryStatusCommandParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalid();
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return invalid();
  }
  if (
    typeof body.delivery_status !== 'string' ||
    !statuses.has(body.delivery_status as DeliveryFulfillmentStatus) ||
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1 ||
    typeof body.idempotency_key !== 'string' ||
    body.idempotency_key !== body.idempotency_key.trim() ||
    !IDEMPOTENCY_KEY.test(body.idempotency_key)
  ) {
    return invalid();
  }
  if (
    body.delivery_status === 'exception' &&
    (typeof body.remark !== 'string' || !body.remark.trim())
  ) {
    return invalid('配送异常原因必填');
  }
  if (
    body.remark !== undefined &&
    (typeof body.remark !== 'string' ||
      body.remark !== body.remark.trim() ||
      body.remark.length > 500)
  ) {
    return invalid();
  }
  return {
    ok: true,
    value: {
      delivery_status:
        body.delivery_status as DeliveryFulfillmentStatus,
      expected_version: Number(body.expected_version),
      idempotency_key: body.idempotency_key,
      ...(typeof body.remark === 'string' ? { remark: body.remark } : {}),
    },
  };
}

export function buildAdminDeliveryStatusRequestHash(input: {
  order_id: string;
  delivery_status: DeliveryFulfillmentStatus;
  expected_version: number;
  remark?: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: OPERATION,
        target_id: input.order_id,
        delivery_status: input.delivery_status,
        expected_version: input.expected_version,
        remark: input.remark ?? null,
      }),
    )
    .digest('hex');
}
