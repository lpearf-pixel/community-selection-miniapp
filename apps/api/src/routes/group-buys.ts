import type { FastifyInstance } from '../fastify.js';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';

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
};

type CompleteOrderBody = {
  next_status?: 'preparing' | 'ready' | 'picked' | 'delivered' | 'completed';
};

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

  return prisma.$transaction(async (tx: any) => {
    const existing = await tx.order.findUnique({ where: { client_request_id: body.client_request_id } });
    if (existing) return existing;

    const groupBuy = await tx.groupBuy.findUnique({
      where: { id: body.group_buy_id },
      include: { product: true }
    });
    if (!groupBuy) throw new Error('团购不存在');
    if (groupBuy.status !== 'pending') throw new Error('当前团购不可下单');
    if (groupBuy.end_time.getTime() <= Date.now()) throw new Error('团购已截止');
    const stockResult = await tx.product.updateMany({
      where: { id: groupBuy.product_id, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } }
    });
    if (stockResult.count !== 1) throw new Error('库存不足');

    const amount = groupBuy.price_cents * quantity;
    return tx.order.create({
      data: {
        order_no: makeOrderNo(),
        client_request_id: body.client_request_id,
        user_id: userId,
        group_buy_id: groupBuy.id,
        leader_user_id: groupBuy.leader_user_id,
        total_amount_cents: amount,
        pay_amount_cents: amount,
        pickup_type: body.pickup_type ?? 'store',
        pickup_store_id: body.pickup_store_id,
        community_id: body.community_id ?? groupBuy.community_id,
        receiver_name: body.receiver_name,
        receiver_phone: body.receiver_phone,
        receiver_address: body.receiver_address
      }
    });
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
    await prisma.$transaction(async (tx: any) => {
      await tx.groupBuy.update({
        where: { id: groupBuy.id },
        data: { status: 'failed' }
      });

      const paidOrders = groupBuy.orders.filter((order: any) => order.pay_status === 'paid');
      const unpaidOrders = groupBuy.orders.filter((order: any) => order.pay_status === 'unpaid');

      for (const order of paidOrders) {
        await tx.order.update({
          where: { id: order.id },
          data: { order_status: 'refunding', refund_status: 'pending' }
        });
        await tx.refund.create({
          data: {
            order_id: order.id,
            out_refund_no: `RF${order.order_no}`,
            refund_amount_cents: order.pay_amount_cents - order.refund_amount_cents,
            reason: '未成团自动进入待退款',
            status: 'pending'
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

  app.get('/api/orders/export/picking.csv', async (_request, reply) => {
    const orders = await prisma.order.findMany({
      where: { order_status: { in: ['paid', 'grouped', 'preparing', 'ready'] } },
      include: { group_buy: { include: { product: true, community: true } }, pickup_store: true },
      orderBy: { created_at: 'desc' }
    });
    const header = '订单号,商品,社区,收货人,手机号,状态,金额(元)';
    const rows = orders.map((order: any) => [
      order.order_no,
      order.group_buy?.product?.name ?? '',
      order.group_buy?.community?.name ?? '',
      order.receiver_name,
      order.receiver_phone,
      order.order_status,
      (order.pay_amount_cents / 100).toFixed(2)
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return [header, ...rows].join('\n');
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

  app.post('/api/orders/:id/complete', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as CompleteOrderBody;
      const result = await prisma.$transaction(async (tx: any) => {
        const order = await tx.order.findUnique({
          where: { id },
          include: { group_buy: true }
        });
        if (!order) throw new Error('订单不存在');

        if (body.next_status && order.pay_status === 'paid') {
          return tx.order.update({ where: { id }, data: { order_status: body.next_status, completed_at: body.next_status === 'completed' ? new Date() : undefined } });
        }

        if (order.pay_status !== 'unpaid') return order;
        const groupBuy = order.group_buy;
        if (!groupBuy || groupBuy.status !== 'pending') throw new Error('订单不可完成');
        const quantity = Math.max(1, Math.floor(order.pay_amount_cents / groupBuy.price_cents));
        const nextPeople = groupBuy.current_people + 1;
        const nextQuantity = groupBuy.current_quantity + quantity;
        const nextGroupStatus = nextPeople >= groupBuy.min_people || nextQuantity >= groupBuy.min_quantity ? 'success' : 'pending';

        await tx.groupBuy.update({
          where: { id: groupBuy.id },
          data: {
            current_people: nextPeople,
            current_quantity: nextQuantity,
            status: nextGroupStatus
          }
        });

        if (nextGroupStatus === 'success') {
          await tx.order.updateMany({
            where: { group_buy_id: groupBuy.id, pay_status: 'paid' },
            data: { order_status: 'grouped' }
          });
        }

        return tx.order.update({
          where: { id },
          data: {
            pay_status: 'paid',
            order_status: nextGroupStatus === 'success' ? 'grouped' : 'paid',
            paid_at: new Date()
          }
        });
      });
      return ok(result);
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
