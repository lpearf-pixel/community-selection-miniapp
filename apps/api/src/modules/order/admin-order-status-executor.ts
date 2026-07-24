import { OrderStatus, Prisma } from '@prisma/client';
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
import { markCommissionPendingForCompletedOrder } from '../finance/finance-service.js';
import {
  type AdminOrderStatusCommand,
  type AdminOrderStatusResult,
  buildAdminOrderStatusRequestHash,
} from './admin-order-status-command.js';

const OPERATION = 'admin.order.status.update.v1';
const resultStatuses = new Set([
  'preparing',
  'ready',
  'picked',
  'delivered',
  'completed',
]);

export class AdminOrderCommandError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'INVALID_ADMIN_ORDER_STATUS_COMMAND'
      | 'ADMIN_ORDER_SCOPE_FORBIDDEN'
      | 'ADMIN_ORDER_NOT_FOUND'
      | 'ADMIN_ORDER_VERSION_CONFLICT'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_ORDER_STATUS_UPDATE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AdminOrderCommandError';
  }
}

function commandError(
  statusCode: number,
  code: AdminOrderCommandError['code'],
  message: string,
) {
  return new AdminOrderCommandError(statusCode, code, message);
}

function isResult(value: unknown): value is AdminOrderStatusResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.order_id === 'string' &&
    typeof item.order_no === 'string' &&
    typeof item.order_status === 'string' &&
    resultStatuses.has(item.order_status) &&
    Number.isSafeInteger(item.version) &&
    Number(item.version) >= 2 &&
    (item.completed_at === null || typeof item.completed_at === 'string')
  );
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
}): Promise<AdminOrderStatusResult> {
  if (input.receipt.request_hash !== input.request_hash) {
    throw commandError(
      409,
      'ADMIN_IDEMPOTENCY_KEY_REUSED',
      '幂等键已被其他命令使用',
    );
  }
  const order = await prisma.order.findUnique({
    where: { id: input.order_id },
    select: { id: true, pickup_store_id: true, community_id: true },
  });
  if (!order) {
    throw commandError(404, 'ADMIN_ORDER_NOT_FOUND', '订单不存在');
  }
  if (!canAccessOrderDataScope(input.context, order)) {
    throw commandError(
      403,
      'ADMIN_ORDER_SCOPE_FORBIDDEN',
      '当前管理员无权操作该订单',
    );
  }
  if (
    input.receipt.completed_at === null ||
    input.receipt.response_http_status !== 200 ||
    input.receipt.response_code !== 'ADMIN_ORDER_STATUS_UPDATED' ||
    !isResult(input.receipt.response_data)
  ) {
    throw commandError(
      500,
      'ADMIN_ORDER_STATUS_UPDATE_FAILED',
      '订单状态更新失败',
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

export async function executeAdminOrderStatusCommand(input: {
  order_id: string;
  command: AdminOrderStatusCommand;
  context: AdminAccessContext;
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}): Promise<AdminOrderStatusResult> {
  const requestHash = buildAdminOrderStatusRequestHash({
    order_id: input.order_id,
    next_status: input.command.next_status,
    expected_version: input.command.expected_version,
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
        throw commandError(404, 'ADMIN_ORDER_NOT_FOUND', '订单不存在');
      }
      if (!canAccessOrderDataScope(input.context, before)) {
        throw commandError(
          403,
          'ADMIN_ORDER_SCOPE_FORBIDDEN',
          '当前管理员无权操作该订单',
        );
      }
      if (before.pay_status !== 'paid') {
        throw commandError(
          400,
          'INVALID_ADMIN_ORDER_STATUS_COMMAND',
          '未支付订单不可推进履约',
        );
      }
      if (before.version !== input.command.expected_version) {
        throw commandError(
          409,
          'ADMIN_ORDER_VERSION_CONFLICT',
          '订单已被其他操作更新，请刷新后重试',
        );
      }

      const isCompleted =
        input.command.next_status === OrderStatus.completed;
      const changed = await tx.order.updateMany({
        where: {
          id: input.order_id,
          version: input.command.expected_version,
        },
        data: {
          order_status: input.command.next_status,
          version: { increment: 1 },
          completed_at: isCompleted ? new Date() : undefined,
        },
      });
      if (changed.count !== 1) {
        throw commandError(
          409,
          'ADMIN_ORDER_VERSION_CONFLICT',
          '订单已被其他操作更新，请刷新后重试',
        );
      }
      const after = await tx.order.findUniqueOrThrow({
        where: { id: input.order_id },
      });
      const eventType = isCompleted
        ? 'order_completed'
        : 'order_status_changed';
      await recordBusinessEvent(tx, {
        event_type: eventType,
        event_source: 'admin-order-status-command',
        order_id: input.order_id,
        idempotency_key: input.command.idempotency_key,
        before_snapshot: before,
        after_snapshot: after,
        payload: {
          from_status: before.order_status,
          to_status: input.command.next_status,
          expected_version: input.command.expected_version,
          version: after.version,
        },
      });
      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: eventType,
        target_type: 'Order',
        target_id: input.order_id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          from_status: before.order_status,
          to_status: input.command.next_status,
          expected_version: input.command.expected_version,
          version: after.version,
          idempotency_key: input.command.idempotency_key,
        },
      });
      await recordOrderTimeline(tx, {
        order_id: input.order_id,
        event_type: eventType,
        title: isCompleted ? '订单已完成' : '订单状态已更新',
        from_status: before.order_status,
        to_status: input.command.next_status,
        actor_type: 'admin',
        actor_user_id: input.context.admin_user_id,
        payload: {
          expected_version: input.command.expected_version,
          version: after.version,
        },
      });
      if (isCompleted) {
        await markCommissionPendingForCompletedOrder(input.order_id, tx);
      }

      const result: AdminOrderStatusResult = {
        order_id: after.id,
        order_no: after.order_no,
        order_status:
          after.order_status as AdminOrderStatusResult['order_status'],
        version: after.version,
        completed_at: after.completed_at?.toISOString() ?? null,
      };
      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: 'ADMIN_ORDER_STATUS_UPDATED',
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
        'ADMIN_ORDER_STATUS_UPDATE_FAILED',
        '订单状态更新失败',
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
