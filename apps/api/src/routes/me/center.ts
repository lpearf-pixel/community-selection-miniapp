import type { FastifyInstance } from 'fastify';
import { getMeCenterSummary } from '../../modules/me-center/me-center-service.js';
import { withCurrentUser } from '../current-user-route.js';

export function registerMeCenterRoutes(app: FastifyInstance): void {
  app.get('/api/me/center-summary', (request, reply) =>
    withCurrentUser(request, reply, '个人中心加载失败', (user) =>
      getMeCenterSummary(user.id),
    ),
  );
}
