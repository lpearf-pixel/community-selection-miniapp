import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getActivePickupStore, listActiveCommunities, listActivePickupStores } from '../../modules/user-locations/user-location-service.js';

export function registerPublicLocationRoutes(app: FastifyInstance) {
  app.get('/api/communities', async (request, reply) => {
    try { return ok(await listActiveCommunities(request.query as any)); }
    catch (error) { reply.code((error as any).statusCode ?? 400); return fail(error instanceof Error ? error.message : '社区列表查询失败'); }
  });
  app.get('/api/pickup-stores', async (request, reply) => {
    try { return ok(await listActivePickupStores(request.query as any)); }
    catch (error) { reply.code((error as any).statusCode ?? 400); return fail(error instanceof Error ? error.message : '自提点列表查询失败'); }
  });
  app.get('/api/pickup-stores/:id', async (request, reply) => {
    try { return ok(await getActivePickupStore((request.params as { id: string }).id)); }
    catch (error) { reply.code((error as any).statusCode ?? 400); return fail(error instanceof Error ? error.message : '自提点详情查询失败'); }
  });
}
