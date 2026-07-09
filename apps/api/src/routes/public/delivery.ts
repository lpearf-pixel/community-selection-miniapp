import type { FastifyInstance } from 'fastify';
import { ok } from '@community-selection/shared';
import { getDeliveryRule } from '../../modules/delivery/delivery-rule-service.js';

export function registerPublicDeliveryRoutes(app: FastifyInstance) {
  app.get('/api/delivery/rules', async () => ok(getDeliveryRule()));
}
