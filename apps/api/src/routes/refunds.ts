import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { createPrismaWechatReceiptStore } from '../modules/payment/wechat-payment-notification.js';
import {
  createPrismaWechatRefundLookup,
  processWechatRefundNotification,
} from '../modules/refund/wechat-refund-notification.js';
import { loadWechatRuntimeConfig } from '../modules/wechat/wechat-config.js';
import { verifyAndDecryptWechatNotification } from '../modules/wechat/wechat-notify-verifier.js';
import { markRefundSuccess } from '../services/refund-service.js';

type RefundRouteOptions = {
  paymentMode?: 'mock' | 'wechat';
  processWechatNotification?: (input: {
    rawBody: Buffer;
    headers: Record<string, unknown>;
  }) => Promise<unknown>;
};

function defaultWechatNotificationProcessor() {
  const config = loadWechatRuntimeConfig();
  if (config.paymentMode !== 'wechat') {
    throw new Error('WECHAT_REFUND_MODE_DISABLED');
  }
  const platformPublicKey = readFileSync(config.platformCertificatePath);
  return async (input: {
    rawBody: Buffer;
    headers: Record<string, unknown>;
  }) => {
    const verified = verifyAndDecryptWechatNotification({
      ...input,
      platformSerialNo: config.platformSerialNo,
      platformPublicKey,
      apiV3Key: config.apiV3Key,
    });
    return processWechatRefundNotification({
      verified,
      expectedMerchantId: config.merchantId,
      receipts: createPrismaWechatReceiptStore(),
      refunds: createPrismaWechatRefundLookup(),
      markRefundSuccess,
    });
  };
}

export function registerRefundRoutes(
  app: FastifyInstance,
  options: RefundRouteOptions = {},
) {
  const paymentMode =
    options.paymentMode ??
    (process.env.WECHAT_PAY_MODE === 'wechat' &&
    process.env.MOCK_WECHAT_PAY !== 'true'
      ? 'wechat'
      : 'mock');

  app.get('/api/refunds', async () => {
    const refunds = await prisma.refund.findMany({
      include: {
        order: {
          include: {
            payments: true,
            group_buy: { include: { product: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return ok(refunds);
  });

  app.get('/api/refunds/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const refund = await prisma.refund.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            payments: true,
            group_buy: { include: { product: true } },
          },
        },
      },
    });
    if (!refund) {
      reply.code(404);
      return fail('退款单不存在');
    }
    return ok(refund);
  });

  app.post('/api/refunds/wechat/notify', async (request, reply) => {
    if (paymentMode !== 'wechat') {
      reply.code(403);
      return fail('MOCK 模式拒绝真实微信退款回调');
    }
    if (!request.rawBody) {
      reply.code(400);
      return fail('微信退款回调原始报文缺失');
    }
    try {
      const processNotification =
        options.processWechatNotification ??
        defaultWechatNotificationProcessor();
      await processNotification({
        rawBody: request.rawBody,
        headers: request.headers,
      });
      return reply.code(204).send();
    } catch (error) {
      const code =
        error instanceof Error &&
        /^(?:WECHAT_NOTIFY|WECHAT_REFUND)_/.test(error.message)
          ? 400
          : 500;
      request.log.warn(
        {
          operation: 'wechat-refund-notification',
          error_code:
            error instanceof Error &&
            /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
              ? error.message
              : 'WECHAT_REFUND_NOTIFICATION_FAILED',
        },
        '微信退款回调处理失败',
      );
      reply.code(code);
      return fail('微信退款回调处理失败');
    }
  });
}
