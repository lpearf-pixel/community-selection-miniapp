import type { FastifyInstance } from 'fastify';
import { registerCatalogRoutes } from '../catalog.js';
import { registerGroupBuyRoutes } from '../group-buys.js';
import { registerPaymentRoutes } from '../payments.js';
import { registerRefundRoutes } from '../refunds.js';
import { registerRewardRoutes } from '../rewards.js';

export function registerPublicRoutes(app: FastifyInstance) {
  registerCatalogRoutes(app);
  registerGroupBuyRoutes(app);
  registerPaymentRoutes(app);
  registerRefundRoutes(app);
  registerRewardRoutes(app);
}
