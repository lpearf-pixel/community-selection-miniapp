import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { markCommissionPendingForCompletedOrder } from '../services/commission-service.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from '../services/logging-service.js';

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

type CloneGroupBuyBody = { end_time?: string; pickup_time?: string; price_cents?: number };
type PickingCsvQuery = { date?: string; community_id?: string; group_buy_id?: string; format?: 'summary' | 'detail' };

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function makeOrderNo(): string {
  return `CS${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function dayRange(dateText?: string) {
  const base = dateText ? new Date(`${dateText}T00:00:00.000Z`) : undefined;
  if (dateText && (!base || Number.isNaN(base.getTime()))) throw new Error('日期格式不合法');
  if (!base) return undefined;
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function maskPhone(phone: string) {
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '****';
}

function csvLine(values: unknown[]) {
  return values.map((value) => `"${String(value ?? '').replaceAll('\"', '\"\"')}"`).join(',');
}


type AdminMeta = { admin_user_id?: string | null; ip_address?: string | null; user_agent?: string | null };

function adminMetaFromRequest(request: { adminUser?: { id: string }; ip?: string; headers: Record<string, unknown> }): AdminMeta {
  return {
    admin_user_id: request.adminUser?.id ?? null,
    ip_address: request.ip ?? null,
    user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null
  };
}

function parseCloneTimes(body: CloneGroupBuyBody) {
  const endTime = body.end_time ? new Date(body.end_time) : null;
  const pickupTime = body.pickup_time ? new Date(body.pickup_time) : null;
  if (!endTime || Number.isNaN(endTime.getTime()) || endTime.getTime() <= Date.now()) throw new Error('团购截止时间必须晚于当前时间');
  if (!pickupTime || Number.isNaN(pickupTime.getTime()) || pickupTime.getTime() <= endTime.getTime()) throw new Error('自提时间必须晚于团购截止时间');
  return { endTime, pickupTime };
}

async function cloneGroupBuyById(id: string, body: CloneGroupBuyBody, adminMeta: AdminMeta) {
  const { endTime, pickupTime } = parseCloneTimes(body);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
    await tx.adminAuditLog.create({
      data: {
        admin_user_id: adminMeta.admin_user_id ?? null,
        action: 'group_buy_cloned',
        target_type: 'GroupBuy',
        target_id: created.id,
        ip_address: adminMeta.ip_address ?? null,
        user_agent: adminMeta.user_agent ?? null,
        payload: { source_group_buy_id: source.id }
      }
    });
    return created;
  });
}

async function buildPickingCsv(query: PickingCsvQuery) {
  const range = dayRange(query.date);
  const orders = await prisma.order.findMany({
    where: {
      ...validPaidOrderWhere(),
      ...(query.group_buy_id ? { group_buy_id: query.group_buy_id } : {}),
      ...(query.community_id ? { group_buy: { community_id: query.community_id, ...(range ? { pickup_time: { gte: range.start, lt: range.end } } : {}) } } : range ? { group_buy: { pickup_time: { gte: range.start, lt: range.end } } } : {})
    },
    include: { group_buy: { include: { product: true, community: true } }, pickup_store: true },
    orderBy: { created_at: 'desc' }
  });
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
    order.group_buy?.product?.name ?? '',
    order.quantity,
    order.receiver_name,
    maskPhone(order.receiver_phone),
    order.pickup_store?.name ?? '',
    order.order_status,
    ''
  ]));
  return [header, ...rows].join('\n');
}

function validPaidOrderWhere() {
  return { order_status: { in: ['paid', 'grouped', 'preparing', 'ready', 'picked', 'delivered', 'completed'] as const } };
}

async function getCreditBalance(tx: Prisma.TransactionClient, userId: string) {
  const entries = await tx.consumerCreditLedger.findMany({ where: { user_id: userId } });
  return entries.reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount_cents : -entry.amount_cents), 0);
}

async function findUserIdByOpenid(openid: string, fallbackNickname: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { openid },
    update: { status: 'active' },
    create: { openid, nickname: fallbackNickname, role: 'customer', status: 'active' }
  });
  return user.id;
}

async function createGroupOrder(body: CreateOrderBody) {
  const quantity = positiveInt(body.quantity, 1);
  const userId = body.user_id ?? (body.user_openid ? await findUserIdByOpenid(body.user_openid, body.receiver_name ?? '社区用户') : undefined);
  if (!userId || !body.group_buy_id || !body.client_request_id || !body.receiver_name || !body.receiver_phone) {
    throw new Error('缺少下单必填字段');
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.order.findUnique({ where: { client_request_id: body.client_request_id } });
    if (existing) {
      await safeRecordBusinessEvent(tx, {
        event_type: 'order_idempotent_reused',
        event_source: 'group-buys-route',
        order_id: existing.id,
        idempotency_key: body.client_request_id,
        after_snapshot: existing
      });
      return existing;
    }

    const groupBuy = await tx.groupBuy.findUnique({
      where: { id: body.group_buy_id },
      include: { product: true }
    });
    if (!groupBuy) throw new Error('团购不存在');
    if (groupBuy.status !== 'pending' && groupBuy.status !== 'success') throw new Error('当前团购不可下单');
    if (groupBuy.end_time.getTime() <= Date.now()) throw new Error('团购已截止');
    const stockResult = await tx.product.updateMany({
      where: { id: groupBuy.product_id, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } }
    });
    if (stockResult.count !== 1) throw new Error('库存不足');
    await safeRecordBusinessEvent(tx, {
      event_type: 'order_stock_decremented',
      event_source: 'group-buys-route',
      group_buy_id: groupBuy.id,
      idempotency_key: body.client_request_id,
      payload: { product_id: groupBuy.product_id, quantity }
    });

    const amount = groupBuy.price_cents * quantity;
    const creditAmount = Number(body.credit_amount_cents ?? 0);
    if (!Number.isInteger(creditAmount) || creditAmount < 0) throw new Error('消费额度抵扣金额不合法');
    if (creditAmount > amount) throw new Error('消费额度抵扣金额不能超过订单金额');
    if (creditAmount > 0 && !body.credit_source_id) throw new Error('缺少消费额度来源');

    let creditBalanceAfter: number | null = null;
    if (creditAmount > 0) {
      const conversion = await tx.rewardConversion.findUnique({ where: { id: body.credit_source_id } });
      if (!conversion || conversion.status !== 'success' || conversion.conversion_type !== 'credit' || conversion.leader_user_id !== userId) throw new Error('消费额度来源不可用');
      const currentCreditBalance = await getCreditBalance(tx, userId);
      if (currentCreditBalance < creditAmount) throw new Error('消费额度余额不足');
      creditBalanceAfter = currentCreditBalance - creditAmount;
    }

    const order = await tx.order.create({
      data: {
        order_no: makeOrderNo(),
        client_request_id: body.client_request_id,
        user_id: userId,
        group_buy_id: groupBuy.id,
        leader_user_id: groupBuy.leader_user_id,
        total_amount_cents: amount,
        pay_amount_cents: amount - creditAmount,
        quantity,
        credit_amount_cents: creditAmount,
        credit_source_type: creditAmount > 0 ? 'reward_conversion' : undefined,
        credit_source_id: creditAmount > 0 ? body.credit_source_id : undefined,
        pickup_type: body.pickup_type ?? 'store',
        pickup_store_id: body.pickup_store_id,
        community_id: body.community_id ?? groupBuy.community_id,
        receiver_name: body.receiver_name,
        receiver_phone: body.receiver_phone,
        receiver_address: body.receiver_address
      }
    });
    if (creditAmount > 0) {
      await tx.consumerCreditLedger.create({
        data: {
          user_id: userId,
          source_type: 'order_payment',
          source_id: order.id,
          direction: 'out',
          amount_cents: creditAmount,
          balance_after_cents: creditBalanceAfter ?? 0,
          usable_scope: 'platform_order',
          remark: '订单使用平台消费额度抵扣',
          payload: { credit_source_type: 'reward_conversion', credit_source_id: body.credit_source_id }
        }
      });
      await safeRecordBusinessEvent(tx, {
        event_type: 'reward_credit_used',
        event_source: 'group-buys-route',
        order_id: order.id,
        group_buy_id: groupBuy.id,
        user_id: userId,
        payload: { amount_cents: creditAmount, credit_source_type: 'reward_conversion', credit_source_id: body.credit_source_id }
      });
      await safeRecordOrderTimeline(tx, {
        order_id: order.id,
        event_type: 'reward_credit_used',
        title: '订单使用开团服务奖励转消费额度抵扣',
        actor_type: 'user',
        actor_user_id: userId,
        payload: { amount_cents: creditAmount, credit_source_id: body.credit_source_id }
      });
    }

    await safeRecordBusinessEvent(tx, {
      event_type: 'order_created',
      event_source: 'group-buys-route',
      order_id: order.id,
      group_buy_id: groupBuy.id,
      leader_user_id: groupBuy.leader_user_id,
      user_id: userId,
      idempotency_key: body.client_request_id,
      after_snapshot: order
    });
    await safeRecordOrderTimeline(tx, {
      order_id: order.id,
      event_type: 'order_created',
      title: '订单已创建',
      to_status: order.order_status,
      actor_type: 'user',
      actor_user_id: userId,
      payload: { group_buy_id: groupBuy.id, quantity }
    });
    return order;
  });
}

export async function expireOverdueGroupBuys() {
  const overdueGroupBuys = await prisma.groupBuy.findMany({
    where: {
      status: 'pending',
      end_time: { lt: new Date() }
    },
    include: { orders: true }
  });

  for (const groupBuy of overdueGroupBuys) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.groupBuy.update({
        where: { id: groupBuy.id },
        data: { status: 'failed' }
      });

      const paidOrders = groupBuy.orders.filter((order) => order.pay_status === 'paid');
      const unpaidOrders = groupBuy.orders.filter((order) => order.pay_status === 'unpaid');
      const restoreQuantity = [...paidOrders, ...unpaidOrders].reduce((sum, order) => sum + Math.max(1, order.quantity ?? 1), 0);
      if (restoreQuantity > 0) {
        await tx.product.update({
          where: { id: groupBuy.product_id },
          data: { stock: { increment: restoreQuantity } }
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


export function registerGroupBuyRoutes(app: FastifyInstance) {
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
    return ok(groupBuy);
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
      include: { product: true, community: true, leader_user: true, orders: true }
    });
    if (!groupBuy) {
      reply.code(404);
      return fail('团购不存在');
    }
    return ok(groupBuy);
  });

  app.post('/api/group-buys/:id/clone', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const cloned = await cloneGroupBuyById(id, request.body as CloneGroupBuyBody, adminMetaFromRequest(request));
      return ok(cloned);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '一键再开团失败');
    }
  });

  app.post('/api/admin/group-buys/:id/clone', async (request, reply) => {
    if (!request.adminUser?.id) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    try {
      const { id } = request.params as { id: string };
      const cloned = await cloneGroupBuyById(id, request.body as CloneGroupBuyBody, { ...adminMetaFromRequest(request), admin_user_id: request.adminUser.id });
      return ok(cloned);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '后台一键再开团失败');
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

  app.get('/api/orders', async () => {
    const orders = await prisma.order.findMany({
      include: { group_buy: { include: { product: true, community: true } }, user: true, pickup_store: true },
      orderBy: { created_at: 'desc' }
    });
    return ok(orders);
  });

  app.get('/api/orders/export/picking.csv', async (request, reply) => {
    try {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      return await buildPickingCsv(request.query as PickingCsvQuery);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '导出分拣单失败');
    }
  });

  app.get('/api/admin/orders/export/picking.csv', async (request, reply) => {
    if (!request.adminUser?.id) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    try {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      return await buildPickingCsv(request.query as PickingCsvQuery);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '后台导出分拣单失败');
    }
  });

  app.get('/api/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({
      where: { id },
      include: { group_buy: { include: { product: true, community: true } }, user: true, pickup_store: true }
    });
    if (!order) {
      reply.code(404);
      return fail('订单不存在');
    }
    return ok(order);
  });

  async function updateOrderStatus(id: string, body: UpdateOrderStatusBody, adminMeta?: { admin_user_id?: string | null; ip_address?: string | null; user_agent?: string | null }) {
    if (!body.next_status) throw new Error('缺少订单目标状态');
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new Error('订单不存在');
    if (order.pay_status !== 'paid') throw new Error('未支付订单不可推进履约');
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          order_status: body.next_status,
          completed_at: body.next_status === 'completed' ? new Date() : undefined
        }
      });
      await safeRecordBusinessEvent(tx, {
        event_type: body.next_status === 'completed' ? 'order_completed' : 'order_status_changed',
        event_source: 'group-buys-route',
        order_id: id,
        before_snapshot: order,
        after_snapshot: updatedOrder,
        payload: { from_status: order.order_status, to_status: body.next_status }
      });
      await tx.adminAuditLog.create({
        data: {
          admin_user_id: adminMeta?.admin_user_id ?? null,
          action: body.next_status === 'completed' ? 'order_completed' : 'order_status_changed',
          target_type: 'Order',
          target_id: id,
          ip_address: adminMeta?.ip_address ?? null,
          user_agent: adminMeta?.user_agent ?? null,
          payload: { from_status: order.order_status, to_status: body.next_status }
        }
      });
      await safeRecordOrderTimeline(tx, {
        order_id: id,
        event_type: body.next_status === 'completed' ? 'order_completed' : 'order_status_changed',
        title: body.next_status === 'completed' ? '订单已完成' : '订单状态已更新',
        from_status: order.order_status,
        to_status: body.next_status,
        payload: { from_status: order.order_status, to_status: body.next_status }
      });
      if (body.next_status === 'completed') await markCommissionPendingForCompletedOrder(id, tx);
      return updatedOrder;
    });
  }

  app.post('/api/orders/:id/status', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await updateOrderStatus(id, request.body as UpdateOrderStatusBody, { admin_user_id: request.adminUser?.id ?? null, ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null }));
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
      return ok(await updateOrderStatus(id, body, { admin_user_id: request.adminUser?.id ?? null, ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null }));
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
