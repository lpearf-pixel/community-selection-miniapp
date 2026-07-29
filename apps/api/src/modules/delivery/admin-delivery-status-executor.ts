import {
  OrderStatus,
  PickupType,
  Prisma,
  type DeliveryFulfillmentStatus,
} from '@prisma/client';
import { prisma } from '../../db.js';
import {
  type AdminAccessContext,
  canAccessOrderDataScope,
} from '../admin-access/admin-access-control.js';
import {
  recordAdminAudit,
  recordBusinessEvent,
  recordOrderTimeline,
} from '../audit/audit-service.js';
import {
  type AdminDeliveryStatusCommand,
  type AdminDeliveryStatusResult,
  buildAdminDeliveryStatusRequestHash,
} from './admin-delivery-status-command.js';
import {
  allowedNextDeliveryStatuses,
  validateDeliveryTransition,
} from './delivery-state-machine.js';

const OPERATION = 'admin.delivery.status.update.v1';
const closedOrderStatuses = new Set<OrderStatus>([
  OrderStatus.closed,
  OrderStatus.refunded,
]);
const deliveryStatuses = new Set<DeliveryFulfillmentStatus>([
  'pending_dispatch',
  'delivering',
  'delivered',
  'exception',
]);

export class AdminDeliveryStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'INVALID_ADMIN_DELIVERY_STATUS_COMMAND'
      | 'ADMIN_DELIVERY_SCOPE_FORBIDDEN'
      | 'ADMIN_DELIVERY_NOT_FOUND'
      | 'ADMIN_DELIVERY_VERSION_CONFLICT'
      | 'ADMIN_DELIVERY_TYPE_CONFLICT'
      | 'ADMIN_DELIVERY_STATE_CONFLICT'
      | 'ADMIN_DELIVERY_TRANSITION_CONFLICT'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_DELIVERY_STATUS_UPDATE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AdminDeliveryStatusError';
  }
}

function commandError(
  statusCode: number,
  code: AdminDeliveryStatusError['code'],
  message: string,
) {
  return new AdminDeliveryStatusError(statusCode, code, message);
}

function isResult(value: unknown): value is AdminDeliveryStatusResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.order_id === 'string' &&
    typeof item.order_no === 'string' &&
    typeof item.delivery_status === 'string' &&
    deliveryStatuses.has(
      item.delivery_status as DeliveryFulfillmentStatus,
    ) &&
    typeof item.order_status === 'string' &&
    Number.isSafeInteger(item.version) &&
    Number(item.version) >= 2 &&
    Array.isArray(item.allowed_next_statuses) &&
    item.allowed_next_statuses.every(
      (status) =>
        typeof status === 'string' &&
        deliveryStatuses.has(status as DeliveryFulfillmentStatus),
    )
  );
}

function assertScope(
  context: AdminAccessContext,
  order: {
    pickup_store_id: string | null;
    community_id: string | null;
  },
) {
  if (!canAccessOrderDataScope(context, order)) {
    throw commandError(
      403,
      'ADMIN_DELIVERY_SCOPE_FORBIDDEN',
      '当前管理员无权操作该订单',
    );
  }
}

function assertEligibility(input: {
  order: {
    pickup_type: PickupType;
    pay_status: string;
    order_status: OrderStatus;
    delivery_status: DeliveryFulfillmentStatus | null;
    version: number;
  };
  command: AdminDeliveryStatusCommand;
}) {
  if (input.order.pickup_type !== PickupType.delivery) {
    throw commandError(
      409,
      'ADMIN_DELIVERY_TYPE_CONFLICT',
      '到店自提订单不可更新配送状态',
    );
  }
  if (
    input.order.pay_status !== 'paid' ||
    closedOrderStatuses.has(input.order.order_status) ||
    input.order.delivery_status === null
  ) {
    throw commandError(
      409,
      'ADMIN_DELIVERY_STATE_CONFLICT',
      '当前订单不可更新配送状态',
    );
  }
  if (input.order.version !== input.command.expected_version) {
    throw commandError(
      409,
      'ADMIN_DELIVERY_VERSION_CONFLICT',
      '订单已被其他操作更新，请刷新后重试',
    );
  }
  try {
    validateDeliveryTransition({
      current: input.order.delivery_status,
      next: input.command.delivery_status,
      remark: input.command.remark,
    });
  } catch (error) {
    throw commandError(
      409,
      'ADMIN_DELIVERY_TRANSITION_CONFLICT',
      error instanceof Error ? error.message : '配送状态流转不合法',
    );
  }
}

async function replayReceipt(input: {
  receipt: {
    request_hash: string;
    response_http_status: number | null;
    response_code: string | null;
    response_data: Prisma.JsonValue | null;
    completed_at: Date | null;
  };
  request_hash: string;
  order_id: string;
  context: AdminAccessContext;
}): Promise<AdminDeliveryStatusResult> {
  if (input.receipt.request_hash !== input.request_hash) {
    throw commandError(
      409,
      'ADMIN_IDEMPOTENCY_KEY_REUSED',
      '幂等键已被其他命令使用',
    );
  }
  const order = await prisma.order.findUnique({
    where: { id: input.order_id },
    select: {
      id: true,
      pickup_store_id: true,
      community_id: true,
    },
  });
  if (!order) {
    throw commandError(404, 'ADMIN_DELIVERY_NOT_FOUND', '订单不存在');
  }
  assertScope(input.context, order);
  if (
    input.receipt.completed_at === null ||
    input.receipt.response_http_status !== 200 ||
    input.receipt.response_code !== 'ADMIN_DELIVERY_STATUS_UPDATED' ||
    !isResult(input.receipt.response_data)
  ) {
    throw commandError(
      500,
      'ADMIN_DELIVERY_STATUS_UPDATE_FAILED',
      '配送状态更新失败',
    );
  }
  return input.receipt.response_data;
}

function isUniqueReceiptConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export async function executeAdminDeliveryStatusCommand(input: {
  order_id: string;
  command: AdminDeliveryStatusCommand;
  context: AdminAccessContext;
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}): Promise<AdminDeliveryStatusResult> {
  const requestHash = buildAdminDeliveryStatusRequestHash({
    order_id: input.order_id,
    delivery_status: input.command.delivery_status,
    expected_version: input.command.expected_version,
    remark: input.command.remark,
  });
  const receiptKey = {
    admin_user_id: input.context.admin_user_id,
    idempotency_key: input.command.idempotency_key,
  };
  const existingReceipt = await prisma.adminCommandReceipt.findUnique({
    where: { admin_user_id_idempotency_key: receiptKey },
  });
  if (existingReceipt) {
    return replayReceipt({
      receipt: existingReceipt,
      request_hash: requestHash,
      order_id: input.order_id,
      context: input.context,
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.adminCommandReceipt.create({
        data: {
          ...receiptKey,
          operation: OPERATION,
          target_id: input.order_id,
          request_hash: requestHash,
        },
      });
      const before = await tx.order.findUnique({
        where: { id: input.order_id },
      });
      if (!before) {
        throw commandError(404, 'ADMIN_DELIVERY_NOT_FOUND', '订单不存在');
      }
      assertScope(input.context, before);
      assertEligibility({ order: before, command: input.command });

      const nextOrderStatus =
        input.command.delivery_status === 'delivered'
          ? OrderStatus.delivered
          : before.order_status;
      const changed = await tx.order.updateMany({
        where: {
          id: input.order_id,
          version: input.command.expected_version,
          pickup_type: PickupType.delivery,
          pay_status: 'paid',
          order_status: { notIn: [OrderStatus.closed, OrderStatus.refunded] },
          delivery_status: before.delivery_status,
        },
        data: {
          delivery_status: input.command.delivery_status,
          delivery_status_updated_at: new Date(),
          order_status: nextOrderStatus,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw commandError(
          409,
          'ADMIN_DELIVERY_VERSION_CONFLICT',
          '订单已被其他操作更新，请刷新后重试',
        );
      }
      const after = await tx.order.findUniqueOrThrow({
        where: { id: input.order_id },
      });
      await recordBusinessEvent(tx, {
        event_type: 'delivery_status_updated',
        event_source: 'admin-delivery-status-command',
        order_id: input.order_id,
        idempotency_key: input.command.idempotency_key,
        before_snapshot: before,
        after_snapshot: after,
        payload: {
          from_status: before.delivery_status,
          to_status: after.delivery_status,
          expected_version: input.command.expected_version,
          version: after.version,
          remark: input.command.remark ?? null,
        },
      });
      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: 'delivery_status_updated',
        target_type: 'Order',
        target_id: input.order_id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          from_status: before.delivery_status,
          to_status: after.delivery_status,
          expected_version: input.command.expected_version,
          version: after.version,
          idempotency_key: input.command.idempotency_key,
          remark: input.command.remark ?? null,
        },
      });
      await recordOrderTimeline(tx, {
        order_id: input.order_id,
        event_type: 'delivery_status_updated',
        title:
          input.command.delivery_status === 'delivered'
            ? '配送已送达'
            : input.command.delivery_status === 'exception'
              ? '配送异常'
              : input.command.delivery_status === 'delivering'
                ? '配送中'
                : '待配送',
        message: input.command.remark,
        from_status: before.delivery_status,
        to_status: after.delivery_status,
        actor_type: 'admin',
        actor_user_id: input.context.admin_user_id,
        payload: {
          expected_version: input.command.expected_version,
          version: after.version,
          remark: input.command.remark ?? null,
        },
      });

      const result: AdminDeliveryStatusResult = {
        order_id: after.id,
        order_no: after.order_no,
        delivery_status: after.delivery_status!,
        order_status: after.order_status,
        version: after.version,
        allowed_next_statuses: allowedNextDeliveryStatuses(
          after.delivery_status!,
        ),
      };
      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: 'ADMIN_DELIVERY_STATUS_UPDATED',
          response_data: result as Prisma.InputJsonValue,
          completed_at: new Date(),
        },
      });
      return result;
    });
  } catch (error) {
    if (!isUniqueReceiptConflict(error)) throw error;
    const receipt = await prisma.adminCommandReceipt.findUnique({
      where: { admin_user_id_idempotency_key: receiptKey },
    });
    if (!receipt) {
      throw commandError(
        500,
        'ADMIN_DELIVERY_STATUS_UPDATE_FAILED',
        '配送状态更新失败',
      );
    }
    return replayReceipt({
      receipt,
      request_hash: requestHash,
      order_id: input.order_id,
      context: input.context,
    });
  }
}
