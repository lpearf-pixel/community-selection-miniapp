import Fastify from 'fastify';
import { contractFail, fail, ok } from '@community-selection/shared';
import { registerPublicRoutes } from './routes/public/index.js';
import { registerAdminRoutes } from './routes/admin/index.js';
import { requireAdminSession } from './routes/admin-auth.js';
import { HTTP_LOGGER_OPTIONS } from './services/http-log-privacy.js';

export function buildApp() {
  const app = Fastify({ logger: HTTP_LOGGER_OPTIONS });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/admin')) return;
    if (request.url.startsWith('/api/admin/auth/login')) return;
    const isV1Contract = Boolean(
      (request.routeOptions.config as { adminContractV1?: boolean })
        .adminContractV1,
    );
    const unauthorized = (message: string) =>
      isV1Contract
        ? contractFail({
            code: 'ADMIN_UNAUTHORIZED',
            message: '管理员身份无效',
            traceId: String(request.id),
          })
        : fail(message);
    const authMode =
      process.env.ADMIN_AUTH_MODE ??
      (process.env.NODE_ENV === 'production' ? 'session' : 'token');
    const adminAuthEnabled =
      process.env.ADMIN_AUTH_ENABLED === 'true' || authMode === 'session';
    if (!adminAuthEnabled) return;
    if (authMode === 'token') {
      const token = request.headers['x-admin-token'];
      if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        reply.code(401).send(unauthorized('后台访问需要管理员令牌'));
        return;
      }
      return;
    }
    const adminUser = await requireAdminSession(request);
    if (!adminUser) {
      reply.code(401).send(unauthorized('后台登录已失效'));
      return;
    }
    request.adminUser = adminUser;
  });

  app.get('/health', async () => ok({ status: 'ok' }));
  app.get('/api/health', async () => ok({ status: 'ok' }));
  registerPublicRoutes(app);
  registerAdminRoutes(app);

  return app;
}
