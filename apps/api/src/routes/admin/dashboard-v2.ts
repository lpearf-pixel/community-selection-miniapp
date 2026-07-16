import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { requireAdminPermission, resolveAdminAccessContext } from '../../modules/admin-access/admin-access-control.js';
import { dashboardAlerts, dashboardOverview, dashboardTrends } from '../../modules/dashboard-v2/dashboard-v2-service.js';
import { DASHBOARD_FINANCE_PERMISSIONS, DASHBOARD_OPERATIONS_PERMISSIONS, type DashboardQuery } from '../../modules/dashboard-v2/dashboard-v2-types.js';
const permissions = [...DASHBOARD_OPERATIONS_PERMISSIONS, ...DASHBOARD_FINANCE_PERMISSIONS] as any;
function readonly(handler: (context: NonNullable<ReturnType<typeof resolveAdminAccessContext>>, query: DashboardQuery) => Promise<unknown>) { return async (request: any, reply: any) => { try { return ok(await handler(resolveAdminAccessContext(request)!, request.query as DashboardQuery)); } catch (error: any) { reply.code(error?.statusCode ?? 400); return fail(error instanceof Error ? error.message : '驾驶舱查询失败'); } }; }
export function registerAdminDashboardV2Routes(app: FastifyInstance) {
 app.get('/api/admin/dashboard-v2/overview', { preHandler: requireAdminPermission(permissions) }, readonly(dashboardOverview));
 app.get('/api/admin/dashboard-v2/trends', { preHandler: requireAdminPermission(permissions) }, readonly(dashboardTrends));
 app.get('/api/admin/dashboard-v2/alerts', { preHandler: requireAdminPermission(permissions) }, readonly(dashboardAlerts));
}
