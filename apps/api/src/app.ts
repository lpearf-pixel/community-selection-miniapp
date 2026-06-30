import Fastify from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerGroupBuyRoutes } from './routes/group-buys.js';
import { registerPaymentRoutes } from './routes/payments.js';
import { registerRefundRoutes } from './routes/refunds.js';
import { registerCommissionRoutes } from './routes/commissions.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerWithdrawalRoutes } from './routes/withdrawals.js';
import { registerRewardRoutes } from './routes/rewards.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.addHook('preHandler', async (request, reply) => {
    const adminAuthEnabled = process.env.ADMIN_AUTH_ENABLED === 'true';
    if (!adminAuthEnabled || !request.url.startsWith('/api/admin')) return;
    const token = request.headers['x-admin-token'];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      reply.code(401).send(fail('后台访问需要管理员令牌'));
      return;
    }
  });

  app.get('/health', async () => ok({ status: 'ok' }));
  registerCatalogRoutes(app);
  registerGroupBuyRoutes(app);
  registerPaymentRoutes(app);
  registerRefundRoutes(app);
  registerCommissionRoutes(app);
  registerLogRoutes(app);
  registerWithdrawalRoutes(app);
  registerRewardRoutes(app);

  return app;
}
