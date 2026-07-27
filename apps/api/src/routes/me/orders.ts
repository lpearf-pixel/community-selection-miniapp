import type { FastifyInstance } from 'fastify';
import {
  createUserOrderAfterSale,
  getUserOrderDetail,
  getUserOrderPickupCode,
  listUserOrderAfterSales,
  listUserOrders,
  type UserAfterSaleSubmission,
  type UserOrderQuery,
} from '../../modules/user-orders/user-order-service.js';
import { withCurrentUser } from '../current-user-route.js';
import { prisma } from '../../db.js';
import { publicCurrentUserError } from '../../modules/current-user/current-user-security.js';

export function registerUserOrderRoutes(app: FastifyInstance) {
  app.get('/api/me/orders', (request, reply) =>
    withCurrentUser(request, reply, '用户订单操作失败', (user) =>
      listUserOrders(user.id, request.query as UserOrderQuery),
    ),
  );

  app.get('/api/me/orders/:id', (request, reply) =>
    withCurrentUser(request, reply, '用户订单操作失败', (user) =>
      getUserOrderDetail(user.id, (request.params as { id: string }).id),
    ),
  );

  app.get('/api/me/orders/:id/after-sales', (request, reply) =>
    withCurrentUser(request, reply, '用户订单操作失败', (user) =>
      listUserOrderAfterSales(user.id, (request.params as { id: string }).id),
    ),
  );

  app.post('/api/me/orders/:id/after-sales', (request, reply) =>
    withCurrentUser(request, reply, '用户订单操作失败', (user) =>
      createUserOrderAfterSale(
        user.id,
        (request.params as { id: string }).id,
        request.body as UserAfterSaleSubmission,
      ),
    ),
  );

  app.get('/api/me/orders/:id/pickup-code', (request, reply) =>
    withCurrentUser(request, reply, '用户订单操作失败', (user) =>
      getUserOrderPickupCode(user.id, (request.params as { id: string }).id),
    ),
  );

  app.get('/api/me/orders/:id/payment-status', (request, reply) =>
    withCurrentUser(request, reply, '支付状态查询失败', async (user) => {
      const orderId = (request.params as { id: string }).id;
      const order = await prisma.order.findFirst({
        where: { id: orderId, user_id: user.id },
        select: {
          id: true,
          pay_status: true,
          order_status: true,
          paid_at: true,
          payments: {
            orderBy: { attempt_no: 'desc' },
            take: 1,
            select: {
              trade_state: true,
              last_provider_error_code: true,
            },
          },
        },
      });
      if (!order) throw publicCurrentUserError('订单不存在', 404);
      return {
        order_id: order.id,
        pay_status: order.pay_status,
        order_status: order.order_status,
        paid_at: order.paid_at,
        provider_state: order.payments[0]?.trade_state ?? null,
      };
    }),
  );
}
