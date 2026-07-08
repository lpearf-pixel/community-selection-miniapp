import type { FastifyInstance } from 'fastify';
import { ok } from '@community-selection/shared';
import { getFinanceAfterSales, getFinanceOrders, getFinanceOverview, getFinanceRefundLedger, getFinanceRefundLedgerCsv, getFinanceRewards, toCsv } from '../../modules/finance/finance-report-service.js';
import { exportRefundPaymentRiskCsv, getRefundPaymentRiskOverview, listRefundPaymentRisks } from '../../modules/finance/refund-risk-service.js';

type Q = { from?: string; to?: string; community_id?: string; pickup_store_id?: string; status?: string; page?: string; page_size?: string; type?: string; order_no?: string; group_buy_id?: string; refund_method?: string; risk_level?: 'high' | 'medium' | 'low' };
function q(query: Q) { return { ...query, page: query.page ? Number(query.page) : undefined, page_size: query.page_size ? Number(query.page_size) : undefined }; }

export function registerAdminFinanceRoutes(app: FastifyInstance) {
  app.get('/api/admin/finance/reconciliation/overview', async (request) => ok(await getFinanceOverview(q(request.query as Q))));
  app.get('/api/admin/finance/reconciliation/orders', async (request) => ok(await getFinanceOrders(q(request.query as Q))));
  app.get('/api/admin/finance/reconciliation/rewards', async (request) => ok(await getFinanceRewards(q(request.query as Q))));
  app.get('/api/admin/finance/reconciliation/after-sales', async (request) => ok(await getFinanceAfterSales(q(request.query as Q))));
  app.get('/api/admin/finance/reconciliation/refunds', async (request) => ok(await getFinanceRefundLedger(q(request.query as Q))));
  app.get('/api/admin/finance/refund-ledger', async (request) => ok(await getFinanceRefundLedger(q(request.query as Q))));
  app.get('/api/admin/finance/refund-risk/overview', async (request) => ok(await getRefundPaymentRiskOverview(q(request.query as Q))));
  app.get('/api/admin/finance/refund-risk/items', async (request) => ok(await listRefundPaymentRisks(q(request.query as Q))));
  app.get('/api/admin/finance/reconciliation/export.csv', async (request, reply) => {
    const query = request.query as Q;
    const rows = query.type === 'rewards' ? await getFinanceRewards(q(query)) : query.type === 'after_sales' ? await getFinanceAfterSales(q(query)) : query.type === 'refunds' ? await getFinanceRefundLedgerCsv(q(query)) : query.type === 'overview' ? [await getFinanceOverview(q(query))] : (await getFinanceOrders(q(query))).items;
    reply.header('content-type', 'text/csv; charset=utf-8');
    return toCsv(rows as Array<Record<string, unknown>>);
  });
  app.get('/api/admin/finance/refund-ledger/export.csv', async (request, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    return toCsv(await getFinanceRefundLedgerCsv(q(request.query as Q)));
  });
  app.get('/api/admin/finance/refund-risk/export.csv', async (request, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    return exportRefundPaymentRiskCsv(q(request.query as Q));
  });
}

