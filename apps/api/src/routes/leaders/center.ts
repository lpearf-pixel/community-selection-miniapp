import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getLeaderCenterSummary } from '../../modules/me-center/me-center-service.js';
import {
  assertCenterIdentityHeader,
  mapCenterRouteError,
} from '../../modules/me-center/me-center-route-security.js';
import { resolveUserIdentity } from '../../modules/user-orders/user-order-service.js';

export function assertLeaderRole(role: string): void {
  if (role !== 'leader') {
    throw Object.assign(new Error('仅开团人可访问团长中心'), { statusCode: 403 });
  }
}

export function registerLeaderCenterRoutes(app: FastifyInstance): void {
  app.get('/api/leaders/me/center-summary', async (request, reply) => {
    try {
      assertCenterIdentityHeader(request.headers);
      const user = await resolveUserIdentity(request);
      assertLeaderRole(user.role);
      return ok(await getLeaderCenterSummary(user.id));
    } catch (error) {
      const mapped = mapCenterRouteError(error, '团长中心加载失败');
      reply.code(mapped.statusCode);
      return fail(mapped.message);
    }
  });
}
