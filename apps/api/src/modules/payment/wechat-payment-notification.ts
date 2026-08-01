import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';

type VerifiedNotification = {
  notificationId: string;
  eventType: string;
  bodySha256: string;
  resource: Record<string, unknown>;
};

export type ReceiptBeginResult =
  | 'new'
  | 'replay'
  | 'collision'
  | 'busy';

const RECEIPT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type WechatReceiptStore = {
  begin(input: {
    notificationId: string;
    notificationType: 'payment' | 'refund';
    eventType: string;
    resourceIdentifier: string | null;
    bodySha256: string;
    claimToken: string;
  }): Promise<ReceiptBeginResult>;
  complete(notificationId: string, claimToken: string): Promise<void>;
  fail(
    notificationId: string,
    claimToken: string,
    code?: string,
  ): Promise<void>;
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
            claim_token: input.claimToken,
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
        if (existing.body_sha256 !== input.bodySha256) {
          return 'collision';
        }
        if (existing.status === 'applied') {
          return 'replay';
        }
        const processingLeaseExpired =
          existing.status === 'processing' &&
          existing.updated_at.getTime() <=
            Date.now() - RECEIPT_PROCESSING_LEASE_MS;
        if (existing.status !== 'failed' && !processingLeaseExpired) {
          return 'busy';
        }
        const claimed =
          await client.wechatNotificationReceipt.updateMany({
            where: {
              id: existing.id,
              body_sha256: input.bodySha256,
              status: existing.status,
              updated_at: existing.updated_at,
            },
            data: {
              status: 'processing',
              claim_token: input.claimToken,
              failure_code: null,
              processed_at: null,
            },
          });
        return claimed.count === 1 ? 'new' : 'busy';
      }
    },
    async complete(notificationId, claimToken) {
      const completed = await client.wechatNotificationReceipt.updateMany({
        where: {
          notification_id: notificationId,
          status: 'processing',
          claim_token: claimToken,
        },
        data: {
          status: 'applied',
          processed_at: new Date(),
          failure_code: null,
        },
      });
      if (completed.count !== 1) {
        throw new Error('WECHAT_NOTIFY_RECEIPT_CLAIM_LOST');
      }
    },
    async fail(notificationId, claimToken, code) {
      const failed = await client.wechatNotificationReceipt.updateMany({
        where: {
          notification_id: notificationId,
          status: 'processing',
          claim_token: claimToken,
        },
        data: {
          status: 'failed',
          processed_at: new Date(),
          failure_code: code ?? 'WECHAT_PAYMENT_NOTIFICATION_FAILED',
        },
      });
      if (failed.count !== 1) {
        throw new Error('WECHAT_NOTIFY_RECEIPT_CLAIM_LOST');
      }
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
  membershipPayments?: {
    findByOutTradeNo(outTradeNo: string): Promise<{
      id: string;
      membership_order_id: string;
      out_trade_no: string;
      amount_cents: number;
      membership_order: { user: { openid: string } };
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
  markMembershipOrderPaid?(
    membershipOrderId: string,
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
  const claimToken = randomUUID();
  const begin = await input.receipts.begin({
    notificationId: input.verified.notificationId,
    notificationType: 'payment',
    eventType: input.verified.eventType,
    resourceIdentifier: outTradeNo,
    bodySha256: input.verified.bodySha256,
    claimToken,
  });
  if (begin === 'replay') return { replay: true };
  if (begin === 'collision') throw new Error('WECHAT_NOTIFY_ID_COLLISION');
  if (begin === 'busy') throw new Error('WECHAT_NOTIFY_IN_PROGRESS');

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
    const requestedOutTradeNo = requireString(resource, 'out_trade_no');
    const payment = await input.payments.findByOutTradeNo(requestedOutTradeNo);
    const membershipPayment = payment || !input.membershipPayments
      ? null
      : await input.membershipPayments.findByOutTradeNo(requestedOutTradeNo);
    if (!payment && !membershipPayment) throw new Error('WECHAT_PAYMENT_NOT_FOUND');
    const expectedAmount = payment?.amount_cents ?? membershipPayment!.amount_cents;
    const amount = object(resource.amount);
    if (
      !amount ||
      amount.currency !== 'CNY' ||
      amount.payer_currency !== 'CNY' ||
      amount.total !== expectedAmount ||
      amount.payer_total !== expectedAmount
    ) {
      throw new Error('WECHAT_PAYMENT_AMOUNT_INVALID');
    }
    const payer = object(resource.payer);
    const expectedOpenid = payment?.order.user.openid ?? membershipPayment!.membership_order.user.openid;
    if (!payer || payer.openid !== expectedOpenid) {
      throw new Error('WECHAT_PAYMENT_OPENID_INVALID');
    }
    const successAt = new Date(requireString(resource, 'success_time'));
    if (Number.isNaN(successAt.getTime())) {
      throw new Error('WECHAT_PAYMENT_SUCCESS_TIME_INVALID');
    }
    const paymentInfo = {
      payment_id: payment?.id ?? membershipPayment!.id,
      out_trade_no: payment?.out_trade_no ?? membershipPayment!.out_trade_no,
      transaction_id: requireString(resource, 'transaction_id'),
      provider_success_at: successAt,
    };
    if (payment) {
      await input.markOrderPaid(payment.order_id, paymentInfo);
    } else {
      if (!input.markMembershipOrderPaid) throw new Error('WECHAT_PAYMENT_TARGET_UNSUPPORTED');
      await input.markMembershipOrderPaid(membershipPayment!.membership_order_id, paymentInfo);
    }
    await input.receipts.complete(
      input.verified.notificationId,
      claimToken,
    );
    return { replay: false };
  } catch (error) {
    await input.receipts.fail(
      input.verified.notificationId,
      claimToken,
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
