import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getUserProductDetail, listUserProductGroupBuys, listUserProducts } from '../../modules/user-products/user-product-service.js';

export function registerUserProductRoutes(app: FastifyInstance) {
  app.get('/api/products', async (request, reply) => {
    try {
      return ok(await listUserProducts(request.query as any));
    } catch (error) {
      reply.code((error as any).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : '商品列表查询失败');
    }
  });

  app.get('/api/products/:id', async (request, reply) => {
    try {
      return ok(await getUserProductDetail((request.params as { id: string }).id));
    } catch (error) {
      reply.code((error as any).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : '商品详情查询失败');
    }
  });

  app.get('/api/products/:id/group-buys', async (request, reply) => {
    try {
      return ok(await listUserProductGroupBuys((request.params as { id: string }).id, request.query as any));
    } catch (error) {
      reply.code((error as any).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : '可参与开团查询失败');
    }
  });
}
