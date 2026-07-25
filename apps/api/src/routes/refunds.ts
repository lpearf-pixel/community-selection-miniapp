import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';

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
