import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getMeCenterSummary } from '../../modules/me-center/me-center-service.js';
import { resolveUserIdentity } from '../../modules/user-orders/user-order-service.js';

export function registerMeCenterRoutes(app: FastifyInstance): void {
  app.get('/api/me/center-summary', async (request, reply) => {
    try {
      const user = await resolveUserIdentity(request);
      return ok(await getMeCenterSummary(user.id));
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : '个人中心加载失败');
    }
  });
}
