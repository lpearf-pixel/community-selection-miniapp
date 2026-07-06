import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { createUserOrderAfterSale, getUserOrderDetail, getUserOrderPickupCode, listUserOrderAfterSales, listUserOrders, resolveUserIdentity } from '../../modules/user-orders/user-order-service.js';

async function withUser(request: any, reply: any, fn: (userId: string) => Promise<unknown>) {
  try {
    const user = await resolveUserIdentity(request);
    return ok(await fn(user.id));
  } catch (error) {
    reply.code((error as any).statusCode ?? 400);
    return fail(error instanceof Error ? error.message : '用户订单操作失败');
  }
}

export function registerUserOrderRoutes(app: FastifyInstance) {
  app.get('/api/me/orders', async (request, reply) => withUser(request, reply, (userId) => listUserOrders(userId, request.query as any)));
  app.get('/api/me/orders/:id', async (request, reply) => withUser(request, reply, (userId) => getUserOrderDetail(userId, (request.params as { id: string }).id)));
  app.get('/api/me/orders/:id/after-sales', async (request, reply) => withUser(request, reply, (userId) => listUserOrderAfterSales(userId, (request.params as { id: string }).id)));
  app.post('/api/me/orders/:id/after-sales', async (request, reply) => withUser(request, reply, (userId) => createUserOrderAfterSale(userId, (request.params as { id: string }).id, request.body as any)));
  app.get('/api/me/orders/:id/pickup-code', async (request, reply) => withUser(request, reply, (userId) => getUserOrderPickupCode(userId, (request.params as { id: string }).id)));
}
