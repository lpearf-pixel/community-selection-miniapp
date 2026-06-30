import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { resolveOpsAlert, sanitizePayload } from '../services/logging-service.js';

type BusinessEventQuery = {
  order_id?: string;
  event_type?: string;
  event_level?: 'info' | 'warning' | 'error' | 'critical';
  leader_user_id?: string;
  from?: string;
  to?: string;
};

type AlertQuery = {
  status?: 'open' | 'acknowledged' | 'resolved' | 'ignored';
  alert_level?: 'warning' | 'error' | 'critical';
  order_id?: string;
};

type ResolveBody = {
  resolved_by?: string;
  resolution_note?: string;
};

function parseDateRange(query: { from?: string; to?: string }) {
  return {
    ...(query.from || query.to
      ? {
        created_at: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {})
        }
      }
      : {})
  };
}

function focusFrom(
  events: Array<{ event_type: string }>,
  alerts: Array<{ alert_type: string }>,
  commissions: Array<{ status: string }>,
  creditUsage?: { from_reward_conversion: boolean }
) {
  const eventTypes = new Set(events.map((event) => event.event_type));
  const alertTypes = new Set(alerts.map((alert) => alert.alert_type));
  const focus: string[] = [];
  if (eventTypes.has('payment_amount_mismatch')) focus.push('核查支付金额是否与订单金额一致');
  if (alertTypes.has('refund_after_withdrawn')) focus.push('退款发生在提现后，请人工冲正开团服务奖励');
  if (eventTypes.has('commission_adjusted_after_refund') && commissions.some((item) => item.status === 'available')) focus.push('开团服务奖励已可用后发生退款，请核查可用余额');
  if (eventTypes.has('refund_stock_restore_skipped')) focus.push('库存未自动恢复，请检查是否需要人工入库');
  if (creditUsage?.from_reward_conversion) focus.push('核查该消费额度来源及税务状态');
  return focus;
}

export function registerLogRoutes(app: FastifyInstance) {
  app.get('/api/admin/logs/business-events', async (request) => {
    const query = request.query as BusinessEventQuery;
    const logs = await prisma.businessEventLog.findMany({
      where: {
        ...(query.order_id ? { order_id: query.order_id } : {}),
        ...(query.event_type ? { event_type: query.event_type } : {}),
        ...(query.event_level ? { event_level: query.event_level } : {}),
        ...(query.leader_user_id ? { leader_user_id: query.leader_user_id } : {}),
        ...parseDateRange(query)
      },
      orderBy: { created_at: 'desc' },
      take: 200
    });
    return ok(logs);
  });

  app.get('/api/admin/logs/order-timeline', async (request, reply) => {
    const query = request.query as { order_id?: string };
    if (!query.order_id) {
      reply.code(400);
      return fail('缺少订单 ID');
    }
    const timeline = await prisma.orderTimelineLog.findMany({
      where: { order_id: query.order_id },
      orderBy: { created_at: 'asc' }
    });
    return ok(timeline);
  });

  app.get('/api/admin/logs/alerts', async (request) => {
    const query = request.query as AlertQuery;
    const alerts = await prisma.opsAlertLog.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.alert_level ? { alert_level: query.alert_level } : {}),
        ...(query.order_id ? { order_id: query.order_id } : {})
      },
      orderBy: { created_at: 'desc' },
      take: 200
    });
    return ok(alerts);
  });

  app.post('/api/admin/logs/alerts/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as ResolveBody;
    if (!body.resolved_by || !body.resolution_note) {
      reply.code(400);
      return fail('缺少处理信息');
    }
    const resolved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const alert = await resolveOpsAlert(tx, { id, status: 'resolved', resolved_by: body.resolved_by, resolution_note: body.resolution_note });
      await tx.adminAuditLog.create({ data: { admin_user_id: request.adminUser?.id ?? null, action: 'ops_alert_resolved', target_type: 'OpsAlertLog', target_id: id, ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null, payload: { resolved_by: body.resolved_by } } });
      return alert;
    });
    return ok(resolved);
  });

  app.post('/api/admin/logs/alerts/:id/ignore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as ResolveBody;
    if (!body.resolved_by || !body.resolution_note) {
      reply.code(400);
      return fail('缺少处理信息');
    }
    const ignored = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const alert = await resolveOpsAlert(tx, { id, status: 'ignored', resolved_by: body.resolved_by, resolution_note: body.resolution_note });
      await tx.adminAuditLog.create({ data: { admin_user_id: request.adminUser?.id ?? null, action: 'ops_alert_ignored', target_type: 'OpsAlertLog', target_id: id, ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null, payload: { resolved_by: body.resolved_by } } });
      return alert;
    });
    return ok(ignored);
  });

  app.get('/api/admin/logs/orders/:order_id/ai-context', async (request, reply) => {
    const { order_id } = request.params as { order_id: string };
    const order = await prisma.order.findUnique({
      where: { id: order_id },
      include: { group_buy: { include: { product: true, community: true } }, payments: true, refunds: true, commissions: true }
    });
    if (!order) {
      reply.code(404);
      return fail('订单不存在');
    }
    const [timeline, businessEvents, alerts, creditLedgers, rewardConversion] = await Promise.all([
      prisma.orderTimelineLog.findMany({ where: { order_id }, orderBy: { created_at: 'asc' } }),
      prisma.businessEventLog.findMany({ where: { order_id }, orderBy: { created_at: 'asc' } }),
      prisma.opsAlertLog.findMany({ where: { order_id }, orderBy: { created_at: 'desc' } }),
      prisma.consumerCreditLedger.findMany({
        where: { OR: [{ source_type: 'order_payment', source_id: order_id }, { source_type: 'order_refund', source_id: order_id }] },
        orderBy: { created_at: 'asc' }
      }),
      order.credit_source_type === 'reward_conversion' && order.credit_source_id
        ? prisma.rewardConversion.findUnique({ where: { id: order.credit_source_id } })
        : null
    ]);
    const taxRecord = rewardConversion?.tax_record_id ? await prisma.taxRecord.findUnique({ where: { id: rewardConversion.tax_record_id } }) : null;
    const creditUsage = {
      used_credit: order.credit_amount_cents > 0,
      amount_cents: order.credit_amount_cents,
      source_type: order.credit_source_type,
      source_id: order.credit_source_id,
      from_reward_conversion: order.credit_source_type === 'reward_conversion',
      conversion: rewardConversion,
      tax_status: rewardConversion?.tax_status ?? taxRecord?.tax_status ?? null,
      tax_record: taxRecord,
      ledgers: creditLedgers
    };
    return ok({
      order: sanitizePayload(order),
      timeline,
      business_events: businessEvents,
      alerts,
      credit_usage: sanitizePayload(creditUsage),
      suggested_focus: focusFrom(businessEvents, alerts, order.commissions, creditUsage)
    });
  });
}
