import type { FastifyInstance } from 'fastify';
import { ok } from '@community-selection/shared';
import { getOperationsAlerts, getOperationsCommunities, getOperationsOverview, getOperationsPickupStores, getOperationsProducts, getOperationsTrends, toOperationsCsv } from '../../modules/operations/operations-dashboard-service.js';

type Q = { from?: string; to?: string; community_id?: string; pickup_store_id?: string; days?: string; sort_by?: string; limit?: string; type?: string };
function q(query: Q) { return { ...query, days: query.days ? Number(query.days) : undefined, limit: query.limit ? Number(query.limit) : undefined }; }
export function registerAdminOperationsRoutes(app: FastifyInstance) {
  app.get('/api/admin/operations/dashboard/overview', async (request) => ok(await getOperationsOverview(q(request.query as Q))));
  app.get('/api/admin/operations/dashboard/trends', async (request) => ok(await getOperationsTrends(q(request.query as Q))));
  app.get('/api/admin/operations/dashboard/products', async (request) => ok(await getOperationsProducts(q(request.query as Q))));
  app.get('/api/admin/operations/dashboard/communities', async (request) => ok(await getOperationsCommunities(q(request.query as Q))));
  app.get('/api/admin/operations/dashboard/pickup-stores', async (request) => ok(await getOperationsPickupStores(q(request.query as Q))));
  app.get('/api/admin/operations/dashboard/alerts', async (request) => ok(await getOperationsAlerts(q(request.query as Q))));
  app.get('/api/admin/operations/dashboard/export.csv', async (request, reply) => { const query = q(request.query as Q); const rows = query.type === 'trends' ? await getOperationsTrends(query) : query.type === 'products' ? await getOperationsProducts(query) : query.type === 'communities' ? await getOperationsCommunities(query) : query.type === 'pickup_stores' ? await getOperationsPickupStores(query) : query.type === 'alerts' ? await getOperationsAlerts(query) : [await getOperationsOverview(query)]; reply.header('content-type', 'text/csv; charset=utf-8'); return toOperationsCsv(rows as Array<Record<string, unknown>>); });
}
