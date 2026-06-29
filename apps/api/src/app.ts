import Fastify from './fastify.js';
import { ok } from '@community-selection/shared';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerGroupBuyRoutes } from './routes/group-buys.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ok({ status: 'ok' }));
  registerCatalogRoutes(app);
  registerGroupBuyRoutes(app);

  return app;
}
