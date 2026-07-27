import { prisma } from '../../db.js';

type VerifiedNotification = {
  notificationId: string;
  eventType: string;
  bodySha256: string;
  resource: Record<string, unknown>;
};

export type ReceiptBeginResult = 'new' | 'replay' | 'collision';

export type WechatReceiptStore = {
  begin(input: {
    notificationId: string;
    notificationType: 'payment' | 'refund';
    eventType: string;
    resourceIdentifier: string | null;
    bodySha256: string;
  }): Promise<ReceiptBeginResult>;
  complete(notificationId: string): Promise<void>;
  fail(notificationId: string, code?: string): Promise<void>;
};

export function createPrismaWechatReceiptStore(
  client: typeof prisma = prisma,
): WechatReceiptStore {
  return {
    async begin(input) {
      try {
        await client.wechatNotificationReceipt.create({
          data: {
            notification_id: input.notificationId,
            notification_type: input.notificationType,
            event_type: input.eventType,
            resource_identifier: input.resourceIdentifier,
            body_sha256: input.bodySha256,
          },
        });
        return 'new';
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
        const existing =
          await client.wechatNotificationReceipt.findUniqueOrThrow({
            where: { notification_id: input.notificationId },
          });
        return existing.body_sha256 === input.bodySha256
          ? 'replay'
          : 'collision';
      }
    },
    async complete(notificationId) {
      await client.wechatNotificationReceipt.update({
        where: { notification_id: notificationId },
        data: {
          status: 'applied',
          processed_at: new Date(),
          failure_code: null,
        },
      });
    },
    async fail(notificationId, code) {
      await client.wechatNotificationReceipt.updateMany({
        where: { notification_id: notificationId },
        data: {
          status: 'failed',
          processed_at: new Date(),
          failure_code: code ?? 'WECHAT_PAYMENT_NOTIFICATION_FAILED',
        },
      });
    },
  };
}

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
    throw new Error(`WECHAT_PAYMENT_${key.toUpperCase()}_INVALID`);
  }
  return value;
}

function errorCode(error: unknown): string {
  return error instanceof Error &&
    /^WECHAT_PAYMENT_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'WECHAT_PAYMENT_NOTIFICATION_FAILED';
}

export async function processWechatPaymentNotification(input: {
  verified: VerifiedNotification;
  expectedAppId: string;
  expectedMerchantId: string;
  receipts: WechatReceiptStore;
  payments: {
    findByOutTradeNo(outTradeNo: string): Promise<{
      id: string;
      order_id: string;
      out_trade_no: string;
      amount_cents: number;
      order: { user: { openid: string } };
    } | null>;
  };
  markOrderPaid(
    orderId: string,
    info: {
      payment_id: string;
      out_trade_no: string;
      transaction_id: string;
      provider_success_at: Date;
    },
  ): Promise<unknown>;
}) {
  const resource = input.verified.resource;
  const outTradeNo =
    typeof resource.out_trade_no === 'string'
      ? resource.out_trade_no
      : null;
  const begin = await input.receipts.begin({
    notificationId: input.verified.notificationId,
    notificationType: 'payment',
    eventType: input.verified.eventType,
    resourceIdentifier: outTradeNo,
    bodySha256: input.verified.bodySha256,
  });
  if (begin === 'replay') return { replay: true };
  if (begin === 'collision') throw new Error('WECHAT_NOTIFY_ID_COLLISION');

  try {
    if (
      input.verified.eventType !== 'TRANSACTION.SUCCESS' ||
      requireString(resource, 'trade_state') !== 'SUCCESS' ||
      requireString(resource, 'trade_type') !== 'JSAPI'
    ) {
      throw new Error('WECHAT_PAYMENT_EVENT_INVALID');
    }
    if (
      requireString(resource, 'appid') !== input.expectedAppId ||
      requireString(resource, 'mchid') !== input.expectedMerchantId
    ) {
      throw new Error('WECHAT_PAYMENT_MERCHANT_INVALID');
    }
    const payment = await input.payments.findByOutTradeNo(
      requireString(resource, 'out_trade_no'),
    );
    if (!payment) throw new Error('WECHAT_PAYMENT_NOT_FOUND');
    const amount = object(resource.amount);
    if (
      !amount ||
      amount.currency !== 'CNY' ||
      amount.payer_currency !== 'CNY' ||
      amount.total !== payment.amount_cents ||
      amount.payer_total !== payment.amount_cents
    ) {
      throw new Error('WECHAT_PAYMENT_AMOUNT_INVALID');
    }
    const payer = object(resource.payer);
    if (!payer || payer.openid !== payment.order.user.openid) {
      throw new Error('WECHAT_PAYMENT_OPENID_INVALID');
    }
    const successAt = new Date(requireString(resource, 'success_time'));
    if (Number.isNaN(successAt.getTime())) {
      throw new Error('WECHAT_PAYMENT_SUCCESS_TIME_INVALID');
    }
    await input.markOrderPaid(payment.order_id, {
      payment_id: payment.id,
      out_trade_no: payment.out_trade_no,
      transaction_id: requireString(resource, 'transaction_id'),
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

export function createPrismaWechatPaymentLookup(
  client: typeof prisma = prisma,
) {
  return {
    findByOutTradeNo(outTradeNo: string) {
      return client.payment.findUnique({
        where: { out_trade_no: outTradeNo },
        include: { order: { include: { user: true } } },
      });
    },
  };
}
