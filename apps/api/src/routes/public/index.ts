import type { FastifyInstance } from 'fastify';
import { registerCatalogRoutes } from '../catalog.js';
import { registerUserProductRoutes } from './products.js';
import { registerPublicGroupBuyRoutes } from '../group-buys.js';
import { registerPaymentRoutes } from '../payments.js';
import { registerRefundRoutes } from '../refunds.js';
import { registerRewardRoutes } from '../rewards.js';
import { registerPublicAfterSaleRoutes } from '../after-sales.js';
import { registerUserOrderRoutes } from '../me/orders.js';

export function registerPublicRoutes(app: FastifyInstance) {
  registerCatalogRoutes(app);
  registerUserProductRoutes(app);
  registerPublicGroupBuyRoutes(app);
  registerPaymentRoutes(app);
  registerRefundRoutes(app);
  registerRewardRoutes(app);
  registerPublicAfterSaleRoutes(app);
  registerUserOrderRoutes(app);
}
