import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getActivePickupStore } from '../../modules/user-locations/user-location-service.js';

export function registerPublicLocationRoutes(app: FastifyInstance) {
  app.get('/api/pickup-stores/:id', async (request, reply) => {
    try {
      return ok(await getActivePickupStore((request.params as { id: string }).id));
    } catch (error) {
      reply.code((error as any).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : '自提点详情查询失败');
    }
  });
}
