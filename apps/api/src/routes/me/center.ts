import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getMeCenterSummary } from '../../modules/me-center/me-center-service.js';
import {
  assertCenterIdentityHeader,
  mapCenterRouteError,
} from '../../modules/me-center/me-center-route-security.js';
import { resolveUserIdentity } from '../../modules/user-orders/user-order-service.js';

export function registerMeCenterRoutes(app: FastifyInstance): void {
  app.get('/api/me/center-summary', async (request, reply) => {
    try {
      assertCenterIdentityHeader(request.headers);
      const user = await resolveUserIdentity(request);
      return ok(await getMeCenterSummary(user.id));
    } catch (error) {
      const mapped = mapCenterRouteError(error, '个人中心加载失败');
      reply.code(mapped.statusCode);
      return fail(mapped.message);
    }
  });
}
