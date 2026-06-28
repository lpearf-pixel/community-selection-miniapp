import Fastify from 'fastify';
import { ok } from '@community-selection/shared';
import { registerCatalogRoutes } from './routes/catalog.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ok({ status: 'ok' }));
  registerCatalogRoutes(app);

  return app;
}
