import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { buildOutRefundNo, createMockRefund } from '../services/refund-service.js';

type MockRefundBody = {
  order_id?: string;
  refund_amount_cents?: number;
  reason?: string;
  client_refund_id?: string;
};

type WechatRefundApplyBody = MockRefundBody;

function isMockRefundEnabled(): boolean {
  if (process.env.MOCK_WECHAT_PAY === 'true') return true;
  if (process.env.MOCK_WECHAT_PAY === 'false') return false;
  return process.env.WECHAT_PAY_MODE !== 'wechat';
}

function assertWechatRefundConfig() {
  const required = [
    'WECHAT_APP_ID',
    'WECHAT_MCH_ID',
    'WECHAT_MCH_SERIAL_NO',
    'WECHAT_API_V3_KEY',
    'WECHAT_PRIVATE_KEY_PATH',
    'WECHAT_REFUND_NOTIFY_URL'
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`缺少微信退款配置：${missing.join(',')}`);
}

function parseMockRefundBody(body: MockRefundBody) {
  if (!body.order_id || !body.reason) throw new Error('缺少退款必填字段');
  const refundAmount = Number(body.refund_amount_cents);
  if (!Number.isInteger(refundAmount) || refundAmount <= 0) throw new Error('退款金额必须大于 0');
  return {
    order_id: body.order_id,
    refund_amount_cents: refundAmount,
    reason: body.reason,
    client_refund_id: body.client_refund_id
  };
}

export function registerRefundRoutes(app: FastifyInstance) {
  app.get('/api/refunds', async () => {
    const refunds = await prisma.refund.findMany({
      include: {
        order: {
          include: {
            payments: true,
            group_buy: { include: { product: true } }
          }
        }
      },
      orderBy: { created_at: 'desc' }
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
            group_buy: { include: { product: true } }
          }
        }
      }
    });
    if (!refund) {
      reply.code(404);
      return fail('退款单不存在');
    }
    return ok(refund);
  });

  app.post('/api/refunds/mock', async (request, reply) => {
    try {
      return ok(await createMockRefund(parseMockRefundBody(request.body as MockRefundBody)));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : 'MOCK 退款失败');
    }
  });

  app.post('/api/refunds/wechat/apply', async (request, reply) => {
    const body = request.body as WechatRefundApplyBody;
    if (isMockRefundEnabled()) {
      reply.code(400);
      return fail('当前为 MOCK 支付模式，请使用 /api/refunds/mock');
    }

    try {
      assertWechatRefundConfig();
      const input = parseMockRefundBody(body);
      const order = await prisma.order.findUnique({ where: { id: input.order_id } });
      if (!order) throw new Error('订单不存在');
      return ok({
        implemented: false,
        message: '真实微信退款请求结构已预留，待接入微信退款 API/签名工具',
        order_id: order.id,
        out_refund_no: buildOutRefundNo(order, input.client_refund_id),
        refund_amount_cents: input.refund_amount_cents,
        notify_url: process.env.WECHAT_REFUND_NOTIFY_URL
      });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '微信退款申请初始化失败');
    }
  });

  app.post('/api/refunds/wechat/notify', async (_request, reply) => {
    if (isMockRefundEnabled()) {
      reply.code(403);
      return fail('MOCK 模式拒绝真实微信退款回调');
    }

    try {
      assertWechatRefundConfig();
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '微信退款配置错误');
    }

    reply.code(501);
    return fail('真实微信退款回调待实现：TODO 验签、解密、金额校验、幂等更新；未完成验签前不得修改订单');
  });
}
