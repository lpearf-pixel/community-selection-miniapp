import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { markOrderPaid } from '../services/payment-service.js';

type MockPaymentBody = {
  order_id?: string;
};

type WechatJsapiBody = {
  order_id?: string;
  openid?: string;
};

type WechatNotifyBody = {
  out_trade_no?: string;
  transaction_id?: string;
};

function isMockWechatPay(): boolean {
  if (process.env.MOCK_WECHAT_PAY === 'true') return true;
  if (process.env.MOCK_WECHAT_PAY === 'false') return false;
  return process.env.WECHAT_PAY_MODE !== 'wechat';
}

function assertWechatPayConfig() {
  const required = [
    'WECHAT_APP_ID',
    'WECHAT_MCH_ID',
    'WECHAT_MCH_SERIAL_NO',
    'WECHAT_API_V3_KEY',
    'WECHAT_PRIVATE_KEY_PATH',
    'WECHAT_PAY_NOTIFY_URL'
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`缺少微信支付配置：${missing.join(',')}`);
}

function makeOutTradeNo(orderNo: string): string {
  return `PAY${orderNo}`;
}

function makeMockTransactionId(outTradeNo: string): string {
  return `MOCKTXN${outTradeNo}`;
}

function makeWxRequestPaymentShape(outTradeNo: string) {
  return {
    timeStamp: Math.floor(Date.now() / 1000).toString(),
    nonceStr: `nonce_${outTradeNo.slice(-12)}`,
    package: `prepay_id=TODO_${outTradeNo}`,
    signType: 'RSA',
    paySign: 'TODO_SIGN_AFTER_WECHAT_JSAPI_PREPAY'
  };
}

async function createOrReusePayment(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('订单不存在');
  if (order.pay_status === 'closed') throw new Error('订单已关闭');
  if (order.order_status === 'refunding' || order.order_status === 'refunded') throw new Error('退款订单不可支付');

  const outTradeNo = makeOutTradeNo(order.order_no);
  const payment = await prisma.payment.upsert({
    where: { out_trade_no: outTradeNo },
    update: {
      amount_cents: order.pay_amount_cents,
      trade_state: order.pay_status === 'paid' ? 'paid' : 'created'
    },
    create: {
      order_id: order.id,
      out_trade_no: outTradeNo,
      amount_cents: order.pay_amount_cents,
      trade_state: order.pay_status === 'paid' ? 'paid' : 'created'
    }
  });
  return { order, payment };
}

export function registerPaymentRoutes(app: FastifyInstance) {
  app.post('/api/payments/mock', async (request, reply) => {
    const body = request.body as MockPaymentBody;
    if (!body.order_id) {
      reply.code(400);
      return fail('缺少订单 ID');
    }

    try {
      const { payment } = await createOrReusePayment(body.order_id);
      const paid = await markOrderPaid(body.order_id, {
        payment_id: payment.id,
        out_trade_no: payment.out_trade_no,
        transaction_id: payment.transaction_id ?? makeMockTransactionId(payment.out_trade_no),
        raw_notify: { source: 'mock', order_id: body.order_id }
      });
      return ok({ payment: paid.payment ?? payment, order: paid.order });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : 'MOCK 支付失败');
    }
  });

  app.post('/api/payments/wechat/jsapi', async (request, reply) => {
    const body = request.body as WechatJsapiBody;
    if (!body.order_id || !body.openid) {
      reply.code(400);
      return fail('缺少微信支付必填字段');
    }
    if (isMockWechatPay()) {
      reply.code(400);
      return fail('当前为 MOCK 支付模式，请使用 /api/payments/mock');
    }

    try {
      assertWechatPayConfig();
      const { order, payment } = await createOrReusePayment(body.order_id);
      return ok({
        implemented: false,
        message: '真实微信 JSAPI 下单结构已预留，待接入微信支付 SDK/签名工具',
        order_id: order.id,
        openid: body.openid,
        out_trade_no: payment.out_trade_no,
        amount_cents: payment.amount_cents,
        wx_request_payment: makeWxRequestPaymentShape(payment.out_trade_no)
      });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '微信 JSAPI 支付初始化失败');
    }
  });

  app.post('/api/payments/wechat/notify', async (_request, reply) => {
    if (isMockWechatPay()) {
      reply.code(403);
      return fail('MOCK 模式拒绝真实微信支付回调');
    }

    try {
      assertWechatPayConfig();
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '微信支付配置错误');
    }

    reply.code(501);
    return fail('真实微信支付回调待实现：TODO 验签、解密、金额校验、幂等更新；未完成验签前不得修改订单');
  });
}
