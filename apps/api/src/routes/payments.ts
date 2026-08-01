import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import {
  createPrismaWechatPaymentStore,
  createWechatPaymentCommand,
} from '../modules/payment/wechat-payment-command.js';
import {
  createPrismaWechatPaymentLookup,
  createPrismaWechatReceiptStore,
  processWechatPaymentNotification,
} from '../modules/payment/wechat-payment-notification.js';
import { publicCurrentUserError } from '../modules/current-user/current-user-security.js';
import { loadWechatRuntimeConfig } from '../modules/wechat/wechat-config.js';
import {
  createJsapiPaySignature,
  createWechatPayV3Client,
} from '../modules/wechat/wechat-pay-v3-client.js';
import { verifyAndDecryptWechatNotification } from '../modules/wechat/wechat-notify-verifier.js';
import { markOrderPaid } from '../services/payment-service.js';
import {
  createPrismaMembershipPaymentLookup,
  markMembershipOrderPaidFromNotification,
} from '../modules/membership/membership-paid-order.js';
import { safeRecordBusinessEvent } from '../services/logging-service.js';
import { withCurrentUser } from './current-user-route.js';

type PaymentRouteOptions = {
  paymentMode?: 'mock' | 'wechat';
  initializeWechatPayment?: (input: {
    userId: string;
    orderId: string;
    clientIp?: string;
  }) => Promise<unknown>;
  processWechatNotification?: (input: {
    rawBody: Buffer;
    headers: Record<string, unknown>;
  }) => Promise<unknown>;
};

function parseOrderOnlyBody(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  if (entries.length !== 1 || entries[0]?.[0] !== 'order_id') return null;
  const value = entries[0][1];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function makeMockTransactionId(outTradeNo: string): string {
  return `MOCKTXN${outTradeNo}`;
}

function toPublicPaymentResult(input: {
  payment?: {
    id: string;
    transaction_id?: string | null;
  } | null;
  order: {
    id: string;
    order_no: string;
    pay_status: string;
    order_status: string;
    paid_at: Date | null;
    product_amount_cents: number | null;
    total_amount_cents: number;
    delivery_fee_cents: number;
    pay_amount_cents: number;
  };
  mock: boolean;
}) {
  return {
    payment_id: input.payment?.id ?? null,
    order_id: input.order.id,
    order_no: input.order.order_no,
    pay_status: input.order.pay_status,
    order_status: input.order.order_status,
    paid_at: input.order.paid_at,
    product_amount_cents:
      input.order.product_amount_cents ?? input.order.total_amount_cents,
    delivery_fee_cents: input.order.delivery_fee_cents,
    pay_amount_cents: input.order.pay_amount_cents,
    transaction_id: input.payment?.transaction_id ?? null,
    mock: input.mock,
  };
}

function defaultWechatDependencies() {
  const config = loadWechatRuntimeConfig();
  if (config.paymentMode !== 'wechat') {
    throw new Error('WECHAT_PAYMENT_MODE_DISABLED');
  }
  const privateKey = readFileSync(config.merchantPrivateKeyPath);
  const platformPublicKey = readFileSync(config.platformCertificatePath);
  const payClient = createWechatPayV3Client({
    appId: config.appId,
    merchantId: config.merchantId,
    serialNo: config.merchantSerialNo,
    privateKey,
    platformSerialNo: config.platformSerialNo,
    platformPublicKey,
    paymentNotifyUrl: config.paymentNotifyUrl,
    refundNotifyUrl: config.refundNotifyUrl,
  });
  const command = createWechatPaymentCommand({
    store: createPrismaWechatPaymentStore(),
    payClient,
    signJsapi: ({ prepayId }) =>
      createJsapiPaySignature({
        appId: config.appId,
        prepayId,
        privateKey,
      }),
  });
  return {
    initializeWechatPayment: command.initialize,
    async processWechatNotification(input: {
      rawBody: Buffer;
      headers: Record<string, unknown>;
    }) {
      const verified = verifyAndDecryptWechatNotification({
        ...input,
        platformSerialNo: config.platformSerialNo,
        platformPublicKey,
        apiV3Key: config.apiV3Key,
      });
      return processWechatPaymentNotification({
        verified,
        expectedAppId: config.appId,
        expectedMerchantId: config.merchantId,
        receipts: createPrismaWechatReceiptStore(),
        payments: createPrismaWechatPaymentLookup(),
        membershipPayments: createPrismaMembershipPaymentLookup(),
        markOrderPaid,
        markMembershipOrderPaid: markMembershipOrderPaidFromNotification,
      });
    },
  };
}

export function registerPaymentRoutes(
  app: FastifyInstance,
  options: PaymentRouteOptions = {},
) {
  const paymentMode =
    options.paymentMode ??
    (process.env.WECHAT_PAY_MODE === 'wechat' &&
    process.env.MOCK_WECHAT_PAY !== 'true'
      ? 'wechat'
      : 'mock');

  if (paymentMode === 'mock') {
    app.post('/api/payments/mock', (request, reply) =>
      withCurrentUser(request, reply, 'MOCK 支付失败', async (user) => {
        const orderId = parseOrderOnlyBody(request.body);
        if (!orderId) {
          throw publicCurrentUserError('支付请求不合法', 400);
        }
        const store = createPrismaWechatPaymentStore();
        const prepared = await store.prepare(user.id, orderId, new Date());
        const paid = await markOrderPaid(orderId, {
          payment_id: prepared.payment.id,
          out_trade_no: prepared.payment.out_trade_no,
          transaction_id: makeMockTransactionId(
            prepared.payment.out_trade_no,
          ),
          provider_success_at: new Date(),
        });
        await safeRecordBusinessEvent(prisma, {
          event_type: 'payment_mock_success',
          event_source: 'payments-route',
          order_id: orderId,
          payment_id: (paid.payment ?? prepared.payment).id,
          payload: { source: 'mock' },
        });
        return toPublicPaymentResult({
          payment: paid.payment ?? prepared.payment,
          order: paid.order,
          mock: true,
        });
      }),
    );
  }

  app.post('/api/payments/wechat/jsapi', (request, reply) =>
    withCurrentUser(
      request,
      reply,
      '微信 JSAPI 支付初始化失败',
      async (user) => {
        if (paymentMode !== 'wechat') {
          throw publicCurrentUserError('微信支付模式未启用', 400);
        }
        const orderId = parseOrderOnlyBody(request.body);
        if (!orderId) {
          throw publicCurrentUserError('支付请求不合法', 400);
        }
        const dependencies =
          options.initializeWechatPayment || options.processWechatNotification
            ? options
            : defaultWechatDependencies();
        const initialize =
          options.initializeWechatPayment ??
          dependencies.initializeWechatPayment;
        if (!initialize) throw new Error('WECHAT_PAYMENT_UNAVAILABLE');
        return initialize({
          userId: user.id,
          orderId,
          clientIp: request.ip,
        });
      },
    ),
  );

  app.post('/api/payments/wechat/notify', async (request, reply) => {
    if (paymentMode !== 'wechat') {
      reply.code(403);
      return fail('MOCK 模式拒绝真实微信支付回调');
    }
    if (!request.rawBody) {
      reply.code(400);
      return fail('微信支付回调原始报文缺失');
    }
    try {
      const dependencies =
        options.processWechatNotification ||
        options.initializeWechatPayment
          ? options
          : defaultWechatDependencies();
      const processNotification =
        options.processWechatNotification ??
        dependencies.processWechatNotification;
      if (!processNotification) throw new Error('WECHAT_PAYMENT_UNAVAILABLE');
      await processNotification({
        rawBody: request.rawBody,
        headers: request.headers,
      });
      return reply.code(204).send();
    } catch (error) {
      const code =
        error instanceof Error &&
        /^(?:WECHAT_NOTIFY|WECHAT_PAYMENT)_/.test(error.message)
          ? 400
          : 500;
      request.log.warn(
        {
          operation: 'wechat-payment-notification',
          error_code:
            error instanceof Error &&
            /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
              ? error.message
              : 'WECHAT_PAYMENT_NOTIFICATION_FAILED',
        },
        '微信支付回调处理失败',
      );
      reply.code(code);
      return fail('微信支付回调处理失败');
    }
  });

  app.get('/api/public/runtime', async () =>
    ok({ payment_mode: paymentMode, version: 'l51' }),
  );
}
