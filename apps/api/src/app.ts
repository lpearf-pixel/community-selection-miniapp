import Fastify from 'fastify';
import { ok } from '@community-selection/shared';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ok({ status: 'ok' }));

  return app;
}
