import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from '../services/logging-service.js';

type OverviewQuery = { date?: string };

type PickupVerifyBody = { admin_remark?: string };

const effectiveOrderStatuses = ['paid', 'grouped', 'preparing', 'ready', 'picked', 'completed'] as const;

function dayRange(dateText?: string) {
  const base = dateText ? new Date(`${dateText}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(base.getTime())) throw new Error('日期格式不合法');
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function sumAmount(order: { pay_amount_cents: number; refund_amount_cents: number }) {
  return Math.max(0, order.pay_amount_cents - order.refund_amount_cents);
}

export function registerFulfillmentRoutes(app: FastifyInstance) {
  app.get('/api/admin/fulfillment/overview', async (request, reply) => {
    try {
      const { start, end } = dayRange((request.query as OverviewQuery).date);
      const [todayGroupBuys, orders] = await Promise.all([
        prisma.groupBuy.count({ where: { pickup_time: { gte: start, lt: end } } }),
        prisma.order.findMany({
          where: {
            order_status: { in: [...effectiveOrderStatuses] },
            group_buy: { pickup_time: { gte: start, lt: end } }
          },
          include: { group_buy: { include: { product: true, community: true } } }
        })
      ]);

      const byCommunity = new Map<string, { community_id: string; community_name: string; order_count: number; quantity: number; amount_cents: number }>();
      const byProduct = new Map<string, { product_id: string; product_name: string; quantity: number; order_count: number }>();
      for (const order of orders) {
        const community = order.group_buy?.community;
        const product = order.group_buy?.product;
        if (community) {
          const item = byCommunity.get(community.id) ?? { community_id: community.id, community_name: community.name, order_count: 0, quantity: 0, amount_cents: 0 };
          item.order_count += 1;
          item.quantity += order.quantity;
          item.amount_cents += sumAmount(order);
          byCommunity.set(community.id, item);
        }
        if (product) {
          const item = byProduct.get(product.id) ?? { product_id: product.id, product_name: product.name, quantity: 0, order_count: 0 };
          item.order_count += 1;
          item.quantity += order.quantity;
          byProduct.set(product.id, item);
        }
      }

      return ok({
        today_group_buys: todayGroupBuys,
        pending_prepare_orders: orders.filter((order) => order.order_status === 'paid' || order.order_status === 'grouped').length,
        ready_pickup_orders: orders.filter((order) => order.order_status === 'ready').length,
        picked_orders: orders.filter((order) => order.order_status === 'picked').length,
        completed_orders: orders.filter((order) => order.order_status === 'completed').length,
        abnormal_orders: orders.filter((order) => order.refund_status !== 'none').length,
        by_community: [...byCommunity.values()],
        by_product: [...byProduct.values()]
      });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '查询履约看板失败');
    }
  });

  app.post('/api/admin/orders/:id/pickup-verify', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as PickupVerifyBody;
      const order = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.order.findUnique({ where: { id } });
        if (!existing) throw new Error('订单不存在');
        if (existing.order_status === 'picked') return existing;
        if (existing.order_status !== 'ready') throw new Error('当前订单不可核销自提');
        const updated = await tx.order.update({ where: { id }, data: { order_status: 'picked' } });
        await safeRecordOrderTimeline(tx, {
          order_id: id,
          event_type: 'pickup_verified',
          title: '自提已核销',
          from_status: existing.order_status,
          to_status: 'picked',
          actor_type: 'admin',
          actor_user_id: request.adminUser?.id ?? null,
          payload: { admin_remark: body.admin_remark ?? null }
        });
        await safeRecordBusinessEvent(tx, {
          event_type: 'pickup_verified',
          event_source: 'fulfillment-route',
          order_id: id,
          before_snapshot: existing,
          after_snapshot: updated,
          payload: { admin_remark: body.admin_remark ?? null }
        });
        await tx.adminAuditLog.create({
          data: {
            admin_user_id: request.adminUser?.id ?? null,
            action: 'order_pickup_verified',
            target_type: 'Order',
            target_id: id,
            ip_address: request.ip,
            user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
            payload: { admin_remark: body.admin_remark ?? null }
          }
        });
        return updated;
      });
      return ok(order);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '自提核销失败');
    }
  });
}
