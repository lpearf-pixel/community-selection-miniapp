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
import { registerFulfillmentRoutes } from './routes/fulfillment.js';
import { registerAdminAuthRoutes, requireAdminSession } from './routes/admin-auth.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/admin')) return;
    if (request.url.startsWith('/api/admin/auth/login')) return;
    const authMode = process.env.ADMIN_AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'session' : 'token');
    const adminAuthEnabled = process.env.ADMIN_AUTH_ENABLED === 'true' || authMode === 'session';
    if (!adminAuthEnabled) return;
    if (authMode === 'token') {
      const token = request.headers['x-admin-token'];
      if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        reply.code(401).send(fail('后台访问需要管理员令牌'));
        return;
      }
      return;
    }
    const adminUser = await requireAdminSession(request);
    if (!adminUser) {
      reply.code(401).send(fail('后台登录已失效'));
      return;
    }
    request.adminUser = adminUser;
  });

  app.get('/health', async () => ok({ status: 'ok' }));
  registerAdminAuthRoutes(app);
  registerCatalogRoutes(app);
  registerGroupBuyRoutes(app);
  registerPaymentRoutes(app);
  registerRefundRoutes(app);
  registerCommissionRoutes(app);
  registerLogRoutes(app);
  registerFulfillmentRoutes(app);
  registerWithdrawalRoutes(app);
  registerRewardRoutes(app);

  return app;
}
