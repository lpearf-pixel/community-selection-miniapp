import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getMeCenterSummary } from '../../modules/me-center/me-center-service.js';
import {
  mapCenterRouteError,
  resolveCenterUserIdentity,
} from '../../modules/me-center/me-center-route-security.js';

export function registerMeCenterRoutes(app: FastifyInstance): void {
  app.get('/api/me/center-summary', async (request, reply) => {
    try {
      const user = await resolveCenterUserIdentity(request.headers);
      return ok(await getMeCenterSummary(user.id));
    } catch (error) {
      const mapped = mapCenterRouteError(error, '个人中心加载失败');
      reply.code(mapped.statusCode);
      return fail(mapped.message);
    }
  });
}
