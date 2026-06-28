import Fastify from 'fastify';
import { ok, type HealthData } from '@community-selection/shared';

export const buildApp = () => {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ok<HealthData>({ status: 'ok', service: 'api' }));

  return app;
};
