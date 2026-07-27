import { prisma } from '../../db.js';
import type { WechatReceiptStore } from '../payment/wechat-payment-notification.js';

type VerifiedNotification = {
  notificationId: string;
  eventType: string;
  bodySha256: string;
  resource: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(
  resource: Record<string, unknown>,
  key: string,
): string {
  const value = resource[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`WECHAT_REFUND_${key.toUpperCase()}_INVALID`);
  }
  return value;
}

function errorCode(error: unknown): string {
  return error instanceof Error &&
    /^WECHAT_REFUND_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'WECHAT_REFUND_NOTIFICATION_FAILED';
}

export async function processWechatRefundNotification(input: {
  verified: VerifiedNotification;
  expectedMerchantId: string;
  receipts: WechatReceiptStore;
  refunds: {
    findByOutRefundNo(outRefundNo: string): Promise<{
      id: string;
      out_refund_no: string;
      refund_amount_cents: number;
      order: { pay_amount_cents: number };
    } | null>;
  };
  markRefundSuccess(
    refundId: string,
    info: {
      refund_id: string;
      out_refund_no: string;
      provider_status: string;
      provider_success_at: Date;
    },
  ): Promise<unknown>;
}) {
  const resource = input.verified.resource;
  const outRefundNo =
    typeof resource.out_refund_no === 'string'
      ? resource.out_refund_no
      : null;
  const begin = await input.receipts.begin({
    notificationId: input.verified.notificationId,
    notificationType: 'refund',
    eventType: input.verified.eventType,
    resourceIdentifier: outRefundNo,
    bodySha256: input.verified.bodySha256,
  });
  if (begin === 'replay') return { replay: true };
  if (begin === 'collision') throw new Error('WECHAT_NOTIFY_ID_COLLISION');

  try {
    if (
      input.verified.eventType !== 'REFUND.SUCCESS' ||
      requireString(resource, 'refund_status') !== 'SUCCESS'
    ) {
      throw new Error('WECHAT_REFUND_EVENT_INVALID');
    }
    if (requireString(resource, 'mchid') !== input.expectedMerchantId) {
      throw new Error('WECHAT_REFUND_MERCHANT_INVALID');
    }
    const refund = await input.refunds.findByOutRefundNo(
      requireString(resource, 'out_refund_no'),
    );
    if (!refund) throw new Error('WECHAT_REFUND_NOT_FOUND');
    const amount = object(resource.amount);
    if (
      !amount ||
      amount.refund !== refund.refund_amount_cents ||
      amount.payer_refund !== refund.refund_amount_cents ||
      amount.total !== refund.order.pay_amount_cents ||
      amount.payer_total !== refund.order.pay_amount_cents
    ) {
      throw new Error('WECHAT_REFUND_AMOUNT_INVALID');
    }
    if (
      ('currency' in amount && amount.currency !== 'CNY') ||
      ('payer_currency' in amount && amount.payer_currency !== 'CNY')
    ) {
      throw new Error('WECHAT_REFUND_CURRENCY_INVALID');
    }
    const successAt = new Date(requireString(resource, 'success_time'));
    if (Number.isNaN(successAt.getTime())) {
      throw new Error('WECHAT_REFUND_SUCCESS_TIME_INVALID');
    }
    await input.markRefundSuccess(refund.id, {
      refund_id: requireString(resource, 'refund_id'),
      out_refund_no: refund.out_refund_no,
      provider_status: 'SUCCESS',
      provider_success_at: successAt,
    });
    await input.receipts.complete(input.verified.notificationId);
    return { replay: false };
  } catch (error) {
    await input.receipts.fail(
      input.verified.notificationId,
      errorCode(error),
    );
    throw error;
  }
}

export function createPrismaWechatRefundLookup(
  client: typeof prisma = prisma,
) {
  return {
    findByOutRefundNo(outRefundNo: string) {
      return client.refund.findUnique({
        where: { out_refund_no: outRefundNo },
        include: { order: true },
      });
    },
  };
}
