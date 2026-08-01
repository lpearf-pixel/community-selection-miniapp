import {
  OrderStatus,
  PickupType,
  Prisma,
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
  type AdminPickupVerificationCommand,
  type AdminPickupVerificationResult,
  buildAdminPickupVerificationRequestHash,
} from './admin-pickup-verification-command.js';
import {
  createWechatShippingIntent,
  resolvePickupShippingIntent,
} from '../wechat-shipping/wechat-shipping-intent.js';
import { applyOrderGiftFulfillmentEvent } from '../membership/member-gift-fulfillment.js';

const OPERATION = 'admin.order.pickup.verify.v1';

export class AdminPickupVerificationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'ADMIN_ORDER_NOT_FOUND'
      | 'ADMIN_FORBIDDEN'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_ORDER_VERSION_CONFLICT'
      | 'ADMIN_PICKUP_TYPE_CONFLICT'
      | 'ADMIN_PICKUP_STATE_CONFLICT'
      | 'ADMIN_PICKUP_VERIFY_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AdminPickupVerificationError';
  }
}

function commandError(
  statusCode: number,
  code: AdminPickupVerificationError['code'],
  message: string,
) {
  return new AdminPickupVerificationError(statusCode, code, message);
}

function isResult(value: unknown): value is AdminPickupVerificationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.order_id === 'string' &&
    typeof item.order_no === 'string' &&
    item.order_status === OrderStatus.picked &&
    Number.isSafeInteger(item.version) &&
    Number(item.version) >= 2
  );
}

function assertOrderScope(
  context: AdminAccessContext,
  order: {
    pickup_store_id: string | null;
    community_id: string | null;
  },
) {
  if (!canAccessOrderDataScope(context, order)) {
    throw commandError(
      403,
      'ADMIN_FORBIDDEN',
      '当前管理员无权操作该订单',
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
}): Promise<AdminPickupVerificationResult> {
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
    throw commandError(404, 'ADMIN_ORDER_NOT_FOUND', '订单不存在');
  }
  assertOrderScope(input.context, order);

  if (
    input.receipt.completed_at === null ||
    input.receipt.response_http_status !== 200 ||
    input.receipt.response_code !== 'ADMIN_PICKUP_VERIFIED' ||
    !isResult(input.receipt.response_data)
  ) {
    throw commandError(
      500,
      'ADMIN_PICKUP_VERIFY_FAILED',
      '自提核销失败',
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

function assertPickupEligibility(input: {
  order: {
    pickup_type: PickupType;
    order_status: OrderStatus;
    version: number;
  };
  expected_version: number;
}) {
  if (input.order.pickup_type !== PickupType.store) {
    throw commandError(
      409,
      'ADMIN_PICKUP_TYPE_CONFLICT',
      '配送订单不可核销自提',
    );
  }
  if (input.order.order_status !== OrderStatus.ready) {
    throw commandError(
      409,
      'ADMIN_PICKUP_STATE_CONFLICT',
      '当前订单不可核销自提',
    );
  }
  if (input.order.version !== input.expected_version) {
    throw commandError(
      409,
      'ADMIN_ORDER_VERSION_CONFLICT',
      '订单已被其他操作更新，请刷新后重试',
    );
  }
}

export async function executeAdminPickupVerificationCommand(input: {
  order_id: string;
  command: AdminPickupVerificationCommand;
  context: AdminAccessContext;
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}): Promise<AdminPickupVerificationResult> {
  const requestHash = buildAdminPickupVerificationRequestHash({
    order_id: input.order_id,
    expected_version: input.command.expected_version,
    admin_remark: input.command.admin_remark,
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
      assertOrderScope(input.context, before);
      assertPickupEligibility({
        order: before,
        expected_version: input.command.expected_version,
      });

      const changed = await tx.order.updateMany({
        where: {
          id: input.order_id,
          version: input.command.expected_version,
          pickup_type: PickupType.store,
          order_status: OrderStatus.ready,
        },
        data: {
          order_status: OrderStatus.picked,
          version: { increment: 1 },
        },
      });

      if (changed.count !== 1) {
        const current = await tx.order.findUnique({
          where: { id: input.order_id },
        });
        if (!current) {
          throw commandError(404, 'ADMIN_ORDER_NOT_FOUND', '订单不存在');
        }
        assertOrderScope(input.context, current);
        assertPickupEligibility({
          order: current,
          expected_version: input.command.expected_version,
        });
        throw commandError(
          500,
          'ADMIN_PICKUP_VERIFY_FAILED',
          '自提核销失败',
        );
      }

      const after = await tx.order.findUniqueOrThrow({
        where: { id: input.order_id },
      });

      await applyOrderGiftFulfillmentEvent(tx, {
        orderId: input.order_id,
        event: 'pickup_verified',
        actorAdminUserId: input.context.admin_user_id,
        idempotencyKey: `${input.command.idempotency_key}:member-gift:pickup`,
        now: new Date(),
      });

      await createWechatShippingIntent(tx, {
        orderId: input.order_id,
        intent: resolvePickupShippingIntent(),
      });

      await recordBusinessEvent(tx, {
        event_type: 'pickup_verified',
        event_source: 'admin-pickup-verification-command',
        order_id: input.order_id,
        idempotency_key: input.command.idempotency_key,
        before_snapshot: before,
        after_snapshot: after,
        payload: {
          from_status: before.order_status,
          to_status: after.order_status,
          expected_version: input.command.expected_version,
          version: after.version,
          admin_remark: input.command.admin_remark,
        },
      });

      await recordOrderTimeline(tx, {
        order_id: input.order_id,
        event_type: 'pickup_verified',
        title: '自提已核销',
        message: input.command.admin_remark,
        from_status: before.order_status,
        to_status: after.order_status,
        actor_type: 'admin',
        actor_user_id: input.context.admin_user_id,
        payload: {
          expected_version: input.command.expected_version,
          version: after.version,
          admin_remark: input.command.admin_remark,
        },
      });

      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: 'order_pickup_verified',
        target_type: 'Order',
        target_id: input.order_id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          from_status: before.order_status,
          to_status: after.order_status,
          expected_version: input.command.expected_version,
          version: after.version,
          idempotency_key: input.command.idempotency_key,
          admin_remark: input.command.admin_remark,
        },
      });

      const result: AdminPickupVerificationResult = {
        order_id: after.id,
        order_no: after.order_no,
        order_status: 'picked',
        version: after.version,
      };

      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: 'ADMIN_PICKUP_VERIFIED',
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
        'ADMIN_PICKUP_VERIFY_FAILED',
        '自提核销失败',
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
