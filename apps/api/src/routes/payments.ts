import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { markOrderPaid } from './group-buys.js';

type WxLoginBody = {
  code?: string;
};

type PrepayBody = {
  order_id?: string;
};

type PaySuccessBody = {
  order_id?: string;
  out_trade_no?: string;
  transaction_id?: string;
};

function isMockPayEnabled(): boolean {
  return process.env.MOCK_WECHAT_PAY !== 'false';
}

function requireWechatPayConfig() {
  const required = [
    'WECHAT_APP_ID',
    'WECHAT_APP_SECRET',
    'WECHAT_MCH_ID',
    'WECHAT_MCH_SERIAL_NO',
    'WECHAT_API_V3_KEY',
    'WECHAT_PRIVATE_KEY_PATH',
    'WECHAT_PAY_NOTIFY_URL'
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`缺少微信支付配置：${missing.join(',')}`);
  }
}

function makeOutTradeNo(orderNo: string): string {
  return `MOCKPAY${orderNo}`;
}

function makeMockPaymentParams(orderId: string, outTradeNo: string) {
  return {
    timeStamp: Math.floor(Date.now() / 1000).toString(),
    nonceStr: `mock-${orderId.slice(-8)}`,
    package: `prepay_id=mock_${outTradeNo}`,
    signType: 'RSA',
    paySign: `mock-sign-${outTradeNo}`
  };
}

async function ensurePaymentForOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('订单不存在');
  if (order.pay_status === 'closed') throw new Error('订单已关闭');
  if (order.order_status === 'refunding' || order.order_status === 'refunded') throw new Error('退款订单不可支付');

  const outTradeNo = makeOutTradeNo(order.order_no);
  const payment = await prisma.payment.upsert({
    where: { out_trade_no: outTradeNo },
    update: {
      amount_cents: order.pay_amount_cents,
      trade_state: order.pay_status === 'paid' ? 'SUCCESS' : 'NOTPAY',
      prepay_id: `mock_${outTradeNo}`
    },
    create: {
      order_id: order.id,
      out_trade_no: outTradeNo,
      amount_cents: order.pay_amount_cents,
      trade_state: order.pay_status === 'paid' ? 'SUCCESS' : 'NOTPAY',
      prepay_id: `mock_${outTradeNo}`
    }
  });

  return { order, payment };
}

async function markPaymentSuccess(body: PaySuccessBody) {
  const payment = body.out_trade_no
    ? await prisma.payment.findUnique({ where: { out_trade_no: body.out_trade_no } })
    : body.order_id
      ? (await ensurePaymentForOrder(body.order_id)).payment
      : null;

  if (!payment) throw new Error('支付单不存在');

  const transactionId = body.transaction_id ?? `mock-txn-${payment.out_trade_no}`;
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      trade_state: 'SUCCESS',
      transaction_id: payment.transaction_id ?? transactionId,
      raw_notify: body
    }
  });
  const order = await markOrderPaid(payment.order_id);
  return { payment: updatedPayment, order };
}

export function registerPaymentRoutes(app: FastifyInstance) {
  app.post('/api/auth/wx-login', async (request, reply) => {
    const body = request.body as WxLoginBody;
    if (!isMockPayEnabled()) {
      try {
        requireWechatPayConfig();
      } catch (error) {
        reply.code(500);
        return fail(error instanceof Error ? error.message : '微信配置错误');
      }
      reply.code(501);
      return fail('真实微信登录待接入');
    }

    const openid = body.code ? `mock-openid-${body.code}` : 'mock-openid-local';
    const user = await prisma.user.upsert({
      where: { openid },
      update: { status: 'active' },
      create: { openid, nickname: '微信 MOCK 用户', role: 'customer', status: 'active' }
    });
    return ok({ openid, user_id: user.id, mock: true });
  });

  app.post('/api/pay/wechat/prepay', async (request, reply) => {
    const body = request.body as PrepayBody;
    if (!body.order_id) {
      reply.code(400);
      return fail('缺少订单 ID');
    }

    try {
      if (!isMockPayEnabled()) requireWechatPayConfig();
      const { order, payment } = await ensurePaymentForOrder(body.order_id);
      return ok({
        order_id: order.id,
        out_trade_no: payment.out_trade_no,
        amount_cents: payment.amount_cents,
        trade_state: payment.trade_state,
        mock: isMockPayEnabled(),
        payment_params: makeMockPaymentParams(order.id, payment.out_trade_no)
      });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '预支付失败');
    }
  });

  app.post('/api/pay/mock/success', async (request, reply) => {
    if (!isMockPayEnabled()) {
      reply.code(403);
      return fail('仅 MOCK 模式允许模拟支付成功');
    }

    try {
      return ok(await markPaymentSuccess(request.body as PaySuccessBody));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '模拟支付失败');
    }
  });

  app.post('/api/pay/wechat/notify', async (request, reply) => {
    try {
      return ok(await markPaymentSuccess(request.body as PaySuccessBody));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '支付回调处理失败');
    }
  });

  app.get('/api/pay/orders/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      reply.code(404);
      return fail('订单不存在');
    }
    const payment = await prisma.payment.findFirst({
      where: { order_id: id },
      orderBy: { created_at: 'desc' }
    });
    return ok({
      order_id: order.id,
      pay_status: order.pay_status,
      order_status: order.order_status,
      payment: payment ? {
        out_trade_no: payment.out_trade_no,
        transaction_id: payment.transaction_id,
        trade_state: payment.trade_state,
        amount_cents: payment.amount_cents
      } : null
    });
  });
}
