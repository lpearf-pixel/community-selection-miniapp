import type { FastifyInstance } from 'fastify';
import { ok } from '@community-selection/shared';
import { getDeliveryRule } from '../../modules/delivery/delivery-rule-service.js';

type DeliveryRuleQuery = { pickup_store_id?: string };
export function registerPublicDeliveryRoutes(app: FastifyInstance) {
  app.get('/api/delivery/rules', async (request) => ok(await getDeliveryRule({ pickup_store_id: (request.query as DeliveryRuleQuery).pickup_store_id })));
}
