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
}
