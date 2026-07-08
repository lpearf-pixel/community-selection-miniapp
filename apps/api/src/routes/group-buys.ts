import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { createGroupOrder, createNormalOrder, updateOrderStatus } from '../modules/order/order-service.js';
import { safeRecordBusinessEvent } from '../services/logging-service.js';
import { recordAdminAudit } from '../modules/audit/audit-service.js';

type CreateGroupBuyBody = {
  product_id?: string;
  leader_user_id?: string;
  leader_openid?: string;
  community_id?: string;
  min_people?: number;
  min_quantity?: number;
  end_time?: string;
  pickup_time?: string;
};

type CreateOrderBody = {
  user_id?: string;
  user_openid?: string;
  group_buy_id?: string;
  client_request_id?: string;
  quantity?: number;
  pickup_type?: 'store' | 'delivery';
  pickup_store_id?: string;
  community_id?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  credit_amount_cents?: number;
  credit_source_id?: string;
};

type UpdateOrderStatusBody = {
  next_status?: 'preparing' | 'ready' | 'picked' | 'delivered' | 'completed';
};


async function toSafeGroupBuyDetail(groupBuy: any) {
  const paid = await prisma.order.aggregate({
    where: { group_buy_id: groupBuy.id, pay_status: 'paid', order_status: { notIn: ['closed', 'refunded'] }, refund_status: { notIn: ['success'] } },
    _sum: { quantity: true }
  });
  const paidQuantity = paid._sum.quantity ?? 0;
  const targetCount = groupBuy.min_quantity;
  const isExpired = groupBuy.end_time.getTime() <= Date.now();
  return {
    id: groupBuy.id,
    group_buy_id: groupBuy.id,
    product_id: groupBuy.product_id,
    leader_user_id: groupBuy.leader_user_id,
    community_id: groupBuy.community_id,
    status: groupBuy.status,
    min_people: groupBuy.min_people,
    min_quantity: groupBuy.min_quantity,
    target_count: targetCount,
    paid_quantity: paidQuantity,
    remaining_quantity: Math.max(0, targetCount - paidQuantity),
    price_cents: groupBuy.price_cents,
    end_time: groupBuy.end_time.toISOString(),
    pickup_time: groupBuy.pickup_time.toISOString(),
    is_success: groupBuy.status === 'success',
    is_expired: isExpired,
    can_join: (groupBuy.status === 'pending' || groupBuy.status === 'success') && !isExpired && (groupBuy.product?.stock ?? 0) > 0,
    community: groupBuy.community ? { community_id: groupBuy.community.id, name: groupBuy.community.name } : null,
    product: groupBuy.product ? { product_id: groupBuy.product.id, name: groupBuy.product.name, cover_image: groupBuy.product.cover_image, price_cents: groupBuy.product.price_cents, sale_unit: groupBuy.product.sale_unit, sale_spec_name: groupBuy.product.sale_spec_name, stock: groupBuy.product.stock } : null
  };
}

type CloneGroupBuyBody = { end_time?: string; pickup_time?: string; price_cents?: number };
type PickingCsvQuery = { date?: string; community_id?: string; group_buy_id?: string; format?: 'summary' | 'detail' };

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function dayRange(dateText?: string) {
  if (!dateText) return null;
  const start = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function maskPhone(phone?: string | null) {
  if (!phone) return '';
  return phone.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}

function csvLine(values: Array<string | number | null | undefined>) {
  return values.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',');
}

function validPaidOrderWhere(): Prisma.OrderWhereInput {
  return {
    pay_status: 'paid',
    order_status: { in: ['paid', 'grouped', 'preparing', 'ready', 'picked', 'delivered', 'completed'] }
  };
}

export async function expireOverdueGroupBuys() {
  const overdueGroupBuys = await prisma.groupBuy.findMany({
    where: {
      status: 'pending',
      end_time: { lt: new Date() }
    },
    include: { orders: true, product: true }
  });

  for (const groupBuy of overdueGroupBuys) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.groupBuy.update({
        where: { id: groupBuy.id },
        data: { status: 'failed' }
      });

      const paidOrders = groupBuy.orders.filter((order) => order.pay_status === 'paid');
      const unpaidOrders = groupBuy.orders.filter((order) => order.pay_status === 'unpaid');
      const restoreSaleQuantity = [...paidOrders, ...unpaidOrders].reduce((sum, order) => sum + Math.max(1, order.quantity ?? 1), 0);
      const restoreStockQuantity = restoreSaleQuantity * Math.max(1, groupBuy.product.stock_deduct_quantity ?? 1);
      if (restoreStockQuantity > 0) {
        await tx.product.update({
          where: { id: groupBuy.product_id },
          data: { stock: { increment: restoreStockQuantity } }
        });
        await tx.stockLedger.create({
          data: {
            product_id: groupBuy.product_id,
            source_type: 'group_buy_failed_restore',
            source_id: groupBuy.id,
            direction: 'in',
            quantity: restoreStockQuantity,
            stock_before: groupBuy.product.stock,
            stock_after: groupBuy.product.stock + restoreStockQuantity,
            operator_type: 'system',
            remark: '未成团恢复库存',
            payload: { group_buy_id: groupBuy.id, paid_order_count: paidOrders.length, unpaid_order_count: unpaidOrders.length, sale_quantity: restoreSaleQuantity, stock_unit: groupBuy.product.stock_unit, sale_unit: groupBuy.product.sale_unit, sale_spec_name: groupBuy.product.sale_spec_name, stock_deduct_quantity: groupBuy.product.stock_deduct_quantity }
          }
        });
      }

      for (const order of paidOrders) {
        await tx.order.update({
          where: { id: order.id },
          data: { order_status: 'refunding', refund_status: 'pending' }
        });
        await tx.refund.upsert({
          where: { out_refund_no: `RF${order.order_no}` },
          update: {
            refund_amount_cents: order.pay_amount_cents - order.refund_amount_cents,
            reason: '未成团自动进入待退款',
            status: 'pending',
            stock_restored: true
          },
          create: {
            order_id: order.id,
            out_refund_no: `RF${order.order_no}`,
            client_refund_id: `group-expired-${order.id}`,
            refund_amount_cents: order.pay_amount_cents - order.refund_amount_cents,
            reason: '未成团自动进入待退款',
            status: 'pending',
            stock_restored: true
          }
        });
      }

      for (const order of unpaidOrders) {
        await tx.order.update({
          where: { id: order.id },
          data: { order_status: 'closed', pay_status: 'closed' }
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'group_buy_expired',
          target_type: 'GroupBuy',
          target_id: groupBuy.id,
          payload: { paid_orders: paidOrders.length, unpaid_orders: unpaidOrders.length }
        }
      });
    });
  }
}


export function registerPublicGroupBuyRoutes(app: FastifyInstance) {
  app.post('/api/group-buys', async (request, reply) => {
    const body = request.body as CreateGroupBuyBody;
    if (!body.product_id || (!body.leader_user_id && !body.leader_openid) || !body.community_id) {
      reply.code(400);
      return fail('缺少开团必填字段');
    }

    const leaderPromise = body.leader_user_id
      ? prisma.user.findUnique({ where: { id: body.leader_user_id } })
      : prisma.user.findUnique({ where: { openid: body.leader_openid ?? '' } });
    const [product, leader, community] = await Promise.all([
      prisma.product.findUnique({ where: { id: body.product_id } }),
      leaderPromise,
      prisma.community.findUnique({ where: { id: body.community_id } })
    ]);

    if (!product || product.status !== 'active' || !product.is_group_enabled) {
      reply.code(400);
      return fail('商品不可开团');
    }
    if (!leader || leader.role !== 'leader') {
      reply.code(400);
      return fail('只有开团人可以发起开团');
    }
    if (!community || community.status !== 'active') {
      reply.code(400);
      return fail('社区不可用');
    }

    const now = new Date();
    const endTime = body.end_time ? new Date(body.end_time) : addHours(now, 24);
    const pickupTime = body.pickup_time ? new Date(body.pickup_time) : addHours(now, 48);
    if (Number.isNaN(endTime.getTime()) || endTime <= now) {
      reply.code(400);
      return fail('截止时间必须晚于当前时间');
    }
    if (Number.isNaN(pickupTime.getTime()) || pickupTime <= endTime) {
      reply.code(400);
      return fail('自提时间必须晚于截止时间');
    }

    const groupBuy = await prisma.groupBuy.create({
      data: {
        product_id: product.id,
        leader_user_id: leader.id,
        community_id: community.id,
        min_people: positiveInt(body.min_people, 2),
        min_quantity: positiveInt(body.min_quantity, 2),
        price_cents: product.price_cents,
        start_time: now,
        end_time: endTime,
        pickup_time: pickupTime
      },
      include: { product: true, community: true, leader_user: true }
    });
    return ok(await toSafeGroupBuyDetail(groupBuy));
  });

  app.get('/api/group-buys', async () => {
    const groupBuys = await prisma.groupBuy.findMany({
      include: { product: true, community: true, leader_user: true },
      orderBy: { created_at: 'desc' }
    });
    return ok(groupBuys);
  });

  app.get('/api/group-buys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const groupBuy = await prisma.groupBuy.findUnique({
      where: { id },
      include: { product: true, community: true, leader_user: true }
    });
    if (!groupBuy) {
      reply.code(404);
      return fail('团购不存在');
    }
    return ok(await toSafeGroupBuyDetail(groupBuy));
  });

  app.post('/api/group-buys/:id/clone', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as CloneGroupBuyBody;
      const endTime = body.end_time ? new Date(body.end_time) : null;
      const pickupTime = body.pickup_time ? new Date(body.pickup_time) : null;
      if (!endTime || Number.isNaN(endTime.getTime()) || endTime.getTime() <= Date.now()) throw new Error('团购截止时间必须晚于当前时间');
      if (!pickupTime || Number.isNaN(pickupTime.getTime()) || pickupTime.getTime() <= endTime.getTime()) throw new Error('自提时间必须晚于团购截止时间');
      const cloned = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const source = await tx.groupBuy.findUnique({ where: { id } });
        if (!source) throw new Error('原团购不存在');
        const created = await tx.groupBuy.create({
          data: {
            product_id: source.product_id,
            leader_user_id: source.leader_user_id,
            community_id: source.community_id,
            min_people: source.min_people,
            min_quantity: source.min_quantity,
            price_cents: body.price_cents ?? source.price_cents,
            start_time: new Date(),
            end_time: endTime,
            pickup_time: pickupTime,
            status: 'pending'
          }
        });
        await safeRecordBusinessEvent(tx, {
          event_type: 'group_buy_cloned',
          event_source: 'group-buys-route',
          group_buy_id: created.id,
          leader_user_id: source.leader_user_id,
          payload: { source_group_buy_id: source.id }
        });
        return created;
      });
      return ok(cloned);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '一键再开团失败');
    }
  });

  app.post('/api/group-buys/:id/join', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as CreateOrderBody;
      const order = await createGroupOrder({ ...body, group_buy_id: id });
      return ok(order);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '参团失败');
    }
  });

  app.get('/api/leaders/me/dashboard', async (request, reply) => {
    try {
      const query = request.query as { leader_user_id?: string; openid?: string };
      const leader = query.leader_user_id
        ? await prisma.user.findUnique({ where: { id: query.leader_user_id } })
        : await prisma.user.findUnique({ where: { openid: query.openid ?? '' } });
      if (!leader || leader.role !== 'leader') throw new Error('开团人不存在');
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
      const [activeGroupBuys, orders, commissions, conversions] = await Promise.all([
        prisma.groupBuy.count({ where: { leader_user_id: leader.id, status: { in: ['pending', 'success', 'preparing', 'ready'] } } }),
        prisma.order.findMany({ where: { leader_user_id: leader.id, order_status: { in: ['paid', 'grouped', 'preparing', 'ready', 'picked', 'completed'] } } }),
        prisma.commission.findMany({ where: { leader_user_id: leader.id } }),
        prisma.rewardConversion.findMany({ where: { leader_user_id: leader.id, status: 'success' } })
      ]);
      const effectiveAmount = (order: { pay_amount_cents: number; refund_amount_cents: number }) => Math.max(0, order.pay_amount_cents - order.refund_amount_cents);
      const todayOrders = orders.filter((order) => order.created_at >= todayStart && order.created_at < todayEnd);
      const sumCommission = (status: string) => commissions.filter((item) => item.status === status).reduce((sum, item) => sum + item.final_amount_cents, 0);
      return ok({
        active_group_buys: activeGroupBuys,
        today_orders: todayOrders.length,
        today_amount_cents: todayOrders.reduce((sum, order) => sum + effectiveAmount(order), 0),
        total_orders: orders.length,
        total_amount_cents: orders.reduce((sum, order) => sum + effectiveAmount(order), 0),
        pending_commission_cents: sumCommission('pending'),
        available_commission_cents: sumCommission('available'),
        withdrawing_commission_cents: sumCommission('withdrawing'),
        withdrawn_commission_cents: sumCommission('withdrawn'),
        converted_credit_cents: conversions.reduce((sum, item) => sum + item.amount_cents, 0)
      });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '查询开团人看板失败');
    }
  });

  app.post('/api/orders', async (request, reply) => {
    try {
      const order = await createGroupOrder(request.body as CreateOrderBody);
      return ok(order);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '下单失败');
    }
  });

  app.post('/api/orders/normal', async (request, reply) => {
    try {
      const order = await createNormalOrder(request.body as CreateOrderBody & { product_id?: string });
      return ok(order);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '普通购买下单失败');
    }
  });

  app.get('/api/orders', async () => {
    const orders = await prisma.order.findMany({
      include: { product: true, group_buy: { include: { product: true, community: true } }, user: true, pickup_store: true },
      orderBy: { created_at: 'desc' }
    });
    return ok(orders);
  });

  app.get('/api/orders/export/picking.csv', async (request, reply) => {
    try {
      const query = request.query as PickingCsvQuery;
      const range = dayRange(query.date);
      const orders = await prisma.order.findMany({
        where: {
          ...validPaidOrderWhere(),
          ...(query.group_buy_id ? { group_buy_id: query.group_buy_id } : {}),
          ...(query.community_id ? { group_buy: { community_id: query.community_id, ...(range ? { pickup_time: { gte: range.start, lt: range.end } } : {}) } } : range ? { group_buy: { pickup_time: { gte: range.start, lt: range.end } } } : {})
        },
        include: { product: true, group_buy: { include: { product: true, community: true } }, pickup_store: true },
        orderBy: { created_at: 'desc' }
      });
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      if (query.format === 'summary') {
        const summary = new Map<string, { community_name: string; product_name: string; total_quantity: number; order_count: number }>();
        for (const order of orders) {
          const communityName = order.group_buy?.community?.name ?? '';
          const productName = order.group_buy?.product?.name ?? '';
          const key = `${communityName}::${productName}`;
          const item = summary.get(key) ?? { community_name: communityName, product_name: productName, total_quantity: 0, order_count: 0 };
          item.total_quantity += order.quantity;
          item.order_count += 1;
          summary.set(key, item);
        }
        return ['community_name,product_name,total_quantity,order_count', ...[...summary.values()].map((item) => csvLine([item.community_name, item.product_name, item.total_quantity, item.order_count]))].join('\n');
      }
      const header = 'order_no,community_name,product_name,quantity,receiver_name,receiver_phone_masked,pickup_store_name,order_status,remark';
      const rows = orders.map((order) => csvLine([
        order.order_no,
        order.group_buy?.community?.name ?? '',
        order.group_buy?.product?.name ?? order.product?.name ?? '',
        order.quantity,
        order.receiver_name,
        maskPhone(order.receiver_phone),
        order.pickup_store?.name ?? '',
        order.order_status,
        ''
      ]));
      return [header, ...rows].join('\n');
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '导出分拣单失败');
    }
  });

  app.get('/api/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({
      where: { id },
      include: { product: true, group_buy: { include: { product: true, community: true } }, user: true, pickup_store: true }
    });
    if (!order) {
      reply.code(404);
      return fail('订单不存在');
    }
    return ok(order);
  });

  app.post('/api/orders/:id/status', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await updateOrderStatus({ order_id: id, next_status: (request.body as UpdateOrderStatusBody).next_status, admin_meta: { admin_user_id: request.adminUser?.id ?? null, ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null } }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '订单状态更新失败');
    }
  });

  app.post('/api/orders/:id/complete', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateOrderStatusBody;
      if (!body.next_status) {
        reply.code(400);
        return fail('支付请使用 /api/payments/mock 或 /api/payments/wechat/jsapi');
      }
      return ok(await updateOrderStatus({ order_id: id, next_status: body.next_status, admin_meta: { admin_user_id: request.adminUser?.id ?? null, ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null } }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '订单完成失败');
    }
  });

  const timer = setInterval(() => {
    void expireOverdueGroupBuys();
  }, 60_000);
  timer.unref?.();
}

export function registerAdminGroupBuyRoutes(app: FastifyInstance) {
  app.post('/api/admin/group-buys/:id/clone', async (request, reply) => {
    const adminUserId = request.adminUser?.id;
    if (!adminUserId) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    try {
      const { id } = request.params as { id: string };
      const body = request.body as CloneGroupBuyBody;
      const endTime = body.end_time ? new Date(body.end_time) : null;
      const pickupTime = body.pickup_time ? new Date(body.pickup_time) : null;
      if (!endTime || Number.isNaN(endTime.getTime()) || endTime.getTime() <= Date.now()) throw new Error('团购截止时间必须晚于当前时间');
      if (!pickupTime || Number.isNaN(pickupTime.getTime()) || pickupTime.getTime() <= endTime.getTime()) throw new Error('自提时间必须晚于团购截止时间');
      const cloned = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const source = await tx.groupBuy.findUnique({ where: { id } });
        if (!source) throw new Error('原团购不存在');
        const created = await tx.groupBuy.create({
          data: {
            product_id: source.product_id,
            leader_user_id: source.leader_user_id,
            community_id: source.community_id,
            min_people: source.min_people,
            min_quantity: source.min_quantity,
            price_cents: body.price_cents ?? source.price_cents,
            start_time: new Date(),
            end_time: endTime,
            pickup_time: pickupTime,
            status: 'pending'
          }
        });
        await safeRecordBusinessEvent(tx, {
          event_type: 'group_buy_cloned',
          event_source: 'group-buys-route',
          group_buy_id: created.id,
          leader_user_id: source.leader_user_id,
          payload: { source_group_buy_id: source.id }
        });
        await recordAdminAudit(tx, {
          admin_user_id: adminUserId,
          action: 'group_buy_cloned',
          target_type: 'GroupBuy',
          target_id: created.id,
          ip_address: request.ip,
          user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
          payload: { source_group_buy_id: source.id }
        });
        return created;
      });
      return ok(cloned);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '后台一键再开团失败');
    }
  });

  app.get('/api/admin/orders/export/picking.csv', async (request, reply) => {
    if (!request.adminUser?.id) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    try {
      const query = request.query as PickingCsvQuery;
      const range = dayRange(query.date);
      const orders = await prisma.order.findMany({
        where: {
          ...validPaidOrderWhere(),
          ...(query.group_buy_id ? { group_buy_id: query.group_buy_id } : {}),
          ...(query.community_id ? { group_buy: { community_id: query.community_id, ...(range ? { pickup_time: { gte: range.start, lt: range.end } } : {}) } } : range ? { group_buy: { pickup_time: { gte: range.start, lt: range.end } } } : {})
        },
        include: { product: true, group_buy: { include: { product: true, community: true } }, pickup_store: true },
        orderBy: { created_at: 'desc' }
      });
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      if (query.format === 'summary') {
        const summary = new Map<string, { community_name: string; product_name: string; total_quantity: number; order_count: number }>();
        for (const order of orders) {
          const communityName = order.group_buy?.community?.name ?? '';
          const productName = order.group_buy?.product?.name ?? '';
          const key = `${communityName}::${productName}`;
          const item = summary.get(key) ?? { community_name: communityName, product_name: productName, total_quantity: 0, order_count: 0 };
          item.total_quantity += order.quantity;
          item.order_count += 1;
          summary.set(key, item);
        }
        return ['community_name,product_name,total_quantity,order_count', ...[...summary.values()].map((item) => csvLine([item.community_name, item.product_name, item.total_quantity, item.order_count]))].join('\n');
      }
      const header = 'order_no,community_name,product_name,quantity,receiver_name,receiver_phone_masked,pickup_store_name,order_status,remark';
      const rows = orders.map((order) => csvLine([
        order.order_no,
        order.group_buy?.community?.name ?? '',
        order.group_buy?.product?.name ?? order.product?.name ?? '',
        order.quantity,
        order.receiver_name,
        maskPhone(order.receiver_phone),
        order.pickup_store?.name ?? '',
        order.order_status,
        ''
      ]));
      return [header, ...rows].join('\n');
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '后台导出分拣单失败');
    }
  });

}

export function registerGroupBuyRoutes(app: FastifyInstance) {
  registerPublicGroupBuyRoutes(app);
  registerAdminGroupBuyRoutes(app);
}
