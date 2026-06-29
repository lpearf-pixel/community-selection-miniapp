import Fastify from 'fastify';
import { ok } from '@community-selection/shared';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerGroupBuyRoutes } from './routes/group-buys.js';
import { registerPaymentRoutes } from './routes/payments.js';
import { registerRefundRoutes } from './routes/refunds.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ok({ status: 'ok' }));
  registerCatalogRoutes(app);
  registerGroupBuyRoutes(app);
  registerPaymentRoutes(app);
  registerRefundRoutes(app);

  return app;
}
