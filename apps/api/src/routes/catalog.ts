import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { listActiveCommunities, listActivePickupStores } from '../modules/user-locations/user-location-service.js';

export function registerCatalogRoutes(app: FastifyInstance) {
  app.get('/api/categories', async () => {
    const categories = await prisma.category.findMany({
      where: { status: 'active' },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }]
    });
    return ok(categories);
  });

  app.get('/api/communities', async (request, reply) => {
    try {
      return ok(await listActiveCommunities(request.query as any));
    } catch (error) {
      reply.code((error as any).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : '社区列表查询失败');
    }
  });

  app.get('/api/pickup-stores', async (request, reply) => {
    try {
      return ok(await listActivePickupStores(request.query as any));
    } catch (error) {
      reply.code((error as any).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : '自提点列表查询失败');
    }
  });
}
