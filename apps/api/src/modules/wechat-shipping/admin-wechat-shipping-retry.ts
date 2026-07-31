import type {
  Prisma,
  WechatShippingIntentStatus,
} from '@prisma/client';
import { prisma } from '../../db.js';
import {
  type AdminAccessContext,
  canAccessOrderDataScope,
} from '../admin-access/admin-access-control.js';
import {
  recordAdminAudit,
  recordBusinessEvent,
} from '../audit/audit-service.js';

type ShippingIntentSummarySource = {
  status: WechatShippingIntentStatus;
  attempt_count: number;
  last_error_code: string | null;
  next_retry_at: Date | null;
  succeeded_at: Date | null;
};

export type AdminWechatShippingSummary = {
  status:
    | 'not_applicable'
    | WechatShippingIntentStatus;
  attempts: number;
  last_error_code: string | null;
  next_retry_at: Date | null;
  succeeded_at: Date | null;
};

export function toAdminWechatShippingSummary(
  intent: ShippingIntentSummarySource | null | undefined,
): AdminWechatShippingSummary {
  return intent
    ? {
        status: intent.status,
        attempts: intent.attempt_count,
        last_error_code: intent.last_error_code,
        next_retry_at: intent.next_retry_at,
        succeeded_at: intent.succeeded_at,
      }
    : {
        status: 'not_applicable',
        attempts: 0,
        last_error_code: null,
        next_retry_at: null,
        succeeded_at: null,
      };
}

export function canRetryWechatShippingIntent(
  status: WechatShippingIntentStatus,
): boolean {
  return status === 'retryable' || status === 'manual_required';
}

export class AdminWechatShippingRetryError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'ADMIN_WECHAT_SHIPPING_NOT_FOUND'
      | 'ADMIN_WECHAT_SHIPPING_FORBIDDEN'
      | 'ADMIN_WECHAT_SHIPPING_STATE_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AdminWechatShippingRetryError';
  }
}

function retryError(
  statusCode: number,
  code: AdminWechatShippingRetryError['code'],
  message: string,
) {
  return new AdminWechatShippingRetryError(statusCode, code, message);
}

export async function executeAdminWechatShippingRetry(input: {
  orderId: string;
  context: AdminAccessContext;
  adminMeta: {
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}): Promise<AdminWechatShippingSummary> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { wechat_shipping_intent: true },
    });
    if (!order?.wechat_shipping_intent) {
      throw retryError(
        404,
        'ADMIN_WECHAT_SHIPPING_NOT_FOUND',
        '该订单没有微信发货同步记录',
      );
    }
    if (!canAccessOrderDataScope(input.context, order)) {
      throw retryError(
        403,
        'ADMIN_WECHAT_SHIPPING_FORBIDDEN',
        '当前管理员无权操作该订单',
      );
    }
    const before = order.wechat_shipping_intent;
    if (!canRetryWechatShippingIntent(before.status)) {
      throw retryError(
        409,
        'ADMIN_WECHAT_SHIPPING_STATE_CONFLICT',
        '当前微信发货同步状态不可人工重试',
      );
    }
    const changed = await tx.wechatShippingIntent.updateMany({
      where: {
        id: before.id,
        status: { in: ['retryable', 'manual_required'] },
      },
      data: {
        status: 'pending',
        last_error_code: null,
        next_retry_at: null,
      },
    });
    if (changed.count !== 1) {
      throw retryError(
        409,
        'ADMIN_WECHAT_SHIPPING_STATE_CONFLICT',
        '微信发货同步状态已变化，请刷新后重试',
      );
    }
    const after = await tx.wechatShippingIntent.findUniqueOrThrow({
      where: { id: before.id },
    });
    await recordBusinessEvent(tx, {
      event_type: 'wechat_shipping_retry_requested',
      event_source: 'admin-wechat-shipping-retry',
      order_id: input.orderId,
      before_snapshot:
        toAdminWechatShippingSummary(before) as Prisma.InputJsonValue,
      after_snapshot:
        toAdminWechatShippingSummary(after) as Prisma.InputJsonValue,
      payload: {
        intent_id: after.id,
        attempts: after.attempt_count,
      },
    });
    await recordAdminAudit(tx, {
      admin_user_id: input.context.admin_user_id,
      action: 'wechat_shipping_retry_requested',
      target_type: 'WechatShippingIntent',
      target_id: after.id,
      ip_address: input.adminMeta.ipAddress ?? null,
      user_agent: input.adminMeta.userAgent ?? null,
      payload: {
        order_id: input.orderId,
        previous_status: before.status,
        attempts: after.attempt_count,
      },
    });
    return toAdminWechatShippingSummary(after);
  });
}
