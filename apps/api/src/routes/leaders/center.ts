import type { FastifyInstance } from 'fastify';
import { getLeaderCenterSummary } from '../../modules/me-center/me-center-service.js';
import { withCurrentLeader } from '../current-user-route.js';

export function registerLeaderCenterRoutes(app: FastifyInstance): void {
  app.get('/api/leaders/me/center-summary', (request, reply) =>
    withCurrentLeader(request, reply, '团长中心加载失败', (leader) =>
      getLeaderCenterSummary(leader.id),
    ),
  );
}
