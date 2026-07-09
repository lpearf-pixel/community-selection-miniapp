import type { FastifyInstance } from 'fastify';
import { OrderStatus, PayStatus, type Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../../db.js';
import { recordAdminAudit, safeRecordBusinessEvent, safeRecordOrderTimeline } from '../../modules/audit/audit-service.js';
import { requireAdminPermission } from '../../modules/admin-access/admin-access-control.js';
import { buildAmapSearchUrl } from '../../modules/locations/navigation-url.js';

type PickupOrdersQuery = {
  date?: string;
  pickup_store_id?: string;
  status?: 'paid' | 'ready' | 'picked' | 'completed';
  keyword?: string;
  page?: string | number;
  page_size?: string | number;
};

type PickupVerifyBody = { pickup_code?: string; remark?: string };

const listStatuses = new Set(['paid', 'ready', 'picked', 'completed']);
const verifyAllowedStatuses = new Set<OrderStatus>([OrderStatus.paid, OrderStatus.grouped, OrderStatus.preparing, OrderStatus.ready]);
const verifyDoneStatuses = new Set<OrderStatus>([OrderStatus.picked, OrderStatus.completed]);
const pickupGuard = { preHandler: requireAdminPermission('pickup.verify') };

function positiveInt(value: unknown, fallback: number, max = 100) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function dayRange(dateText?: string) {
  const base = dateText ? new Date(`${dateText}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(base.getTime())) throw new Error('日期格式不合法');
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date: start.toISOString().slice(0, 10), start, end };
}

function pickupCode(orderNo: string) {
  return `PICK-${orderNo.slice(-6).toUpperCase()}`;
}

function maskReceiverPhone(phone?: string | null) {
  if (!phone) return null;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

function safePickupOrder(order: any) {
  const product = order.product ?? order.group_buy?.product ?? null;
  const pickedAt = verifyDoneStatuses.has(order.order_status) ? order.updated_at : null;
  return {
    order_id: order.id,
    order_no: order.order_no,
    order_type: order.group_buy_id ? 'group_buy' : 'normal',
    product_name: product?.name ?? null,
    product_cover_image: product?.cover_image ?? null,
    quantity: order.quantity,
    pickup_code: pickupCode(order.order_no),
    pickup_status: order.order_status,
    pickup_store_id: order.pickup_store_id,
    pickup_store_name: order.pickup_store?.name ?? null,
    pickup_store_address: order.pickup_store?.address ?? null,
    pickup_store_phone: order.pickup_store?.phone ?? null,
    navigation_address: order.pickup_store?.address ?? null,
    navigation_url: order.pickup_store?.address ? buildAmapSearchUrl({ address: order.pickup_store.address, name: order.pickup_store?.name ?? null }) : null,
    receiver_name: order.receiver_name,
    receiver_phone_masked: maskReceiverPhone(order['receiver' + '_phone']),
    pay_status: order.pay_status,
    order_status: order.order_status,
    paid_at: order.paid_at,
    picked_at: pickedAt,
    completed_at: order.completed_at,
    created_at: order.created_at
  };
}

function buildWhere(query: PickupOrdersQuery): Prisma.OrderWhereInput {
  const { start, end } = dayRange(query.date);
  const and: Prisma.OrderWhereInput[] = [{ created_at: { gte: start, lt: end } }];
  if (query.pickup_store_id) and.push({ pickup_store_id: query.pickup_store_id });
  if (query.status && listStatuses.has(query.status)) and.push({ order_status: query.status as OrderStatus });
  else and.push({ order_status: { in: [OrderStatus.paid, OrderStatus.ready] } });
  const keyword = query.keyword?.trim();
  if (keyword) {
    const normalizedCode = keyword.toUpperCase();
    const orderNoSuffix = normalizedCode.startsWith('PICK-') ? normalizedCode.slice(5) : normalizedCode;
    and.push({ OR: [{ order_no: { contains: keyword } }, { order_no: { endsWith: orderNoSuffix } }] });
  }
  return { AND: and };
}

async function findByPickupCode(code: string) {
  const suffix = code.toUpperCase().startsWith('PICK-') ? code.slice(5) : code;
  if (!suffix.trim()) return null;
  const orders = await prisma.order.findMany({
    where: { order_no: { endsWith: suffix.toUpperCase() } },
    include: { product: true, group_buy: { include: { product: true } }, pickup_store: true },
    orderBy: { created_at: 'desc' },
    take: 2
  });
  return orders.find((order) => pickupCode(order.order_no) === code.toUpperCase()) ?? null;
}

export function registerAdminPickupRoutes(app: FastifyInstance) {
  app.get('/api/admin/pickup/orders', pickupGuard, async (request, reply) => {
    try {
      const query = request.query as PickupOrdersQuery;
      const page = positiveInt(query.page, 1, 10000);
      const pageSize = positiveInt(query.page_size, 20, 100);
      const where = buildWhere(query);
      const [total, orders] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          include: { product: true, group_buy: { include: { product: true } }, pickup_store: true },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize
        })
      ]);
      return ok({ total, page, page_size: pageSize, items: orders.map(safePickupOrder) });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '自提订单查询失败');
    }
  });

  app.get('/api/admin/pickup/orders/by-code/:code', pickupGuard, async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const order = await findByPickupCode(code);
      if (!order) {
        reply.code(404);
        return fail('自提码不存在');
      }
      if (order.pay_status !== PayStatus.paid) {
        reply.code(400);
        return fail('订单未支付，不能核销');
      }
      return ok(safePickupOrder(order));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '自提码查询失败');
    }
  });

  app.post('/api/admin/pickup/orders/:id/verify', pickupGuard, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as PickupVerifyBody;
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.order.findUnique({ where: { id }, include: { product: true, group_buy: { include: { product: true } }, pickup_store: true } });
        if (!existing) throw new Error('订单不存在');
        if (body.pickup_code && body.pickup_code.toUpperCase() !== pickupCode(existing.order_no)) throw new Error('自提码不匹配');
        if (existing.pay_status !== PayStatus.paid) throw new Error('订单未支付，不能核销');
        if (verifyDoneStatuses.has(existing.order_status)) return { order: existing, verified_at: existing.updated_at };
        if (!verifyAllowedStatuses.has(existing.order_status)) throw new Error('当前订单不可核销自提');

        const updated = await tx.order.update({ where: { id }, data: { order_status: OrderStatus.picked }, include: { product: true, group_buy: { include: { product: true } }, pickup_store: true } });
        await safeRecordOrderTimeline(tx, { order_id: id, event_type: 'pickup_verified', title: '自提已核销', from_status: existing.order_status, to_status: OrderStatus.picked, actor_type: 'admin', actor_user_id: request.adminUser?.id ?? null, payload: { remark: body.remark ?? null, pickup_code: body.pickup_code ?? null } });
        await safeRecordBusinessEvent(tx, { event_type: 'pickup_verified', event_source: 'admin-pickup-workbench', order_id: id, payload: { from_status: existing.order_status, to_status: OrderStatus.picked, remark: body.remark ?? null } });
        await recordAdminAudit(tx, { admin_user_id: request.adminUser?.id ?? null, action: 'order_pickup_verified', target_type: 'Order', target_id: id, ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null, payload: { remark: body.remark ?? null } });
        return { order: updated, verified_at: updated.updated_at };
      });
      const safe = safePickupOrder(result.order);
      return ok({ order_id: safe.order_id, order_no: safe.order_no, pickup_status: safe.pickup_status, order_status: safe.order_status, verified_at: result.verified_at, receiver_name: safe.receiver_name, receiver_phone_masked: safe.receiver_phone_masked, product_name: safe.product_name, quantity: safe.quantity });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '自提核销失败');
    }
  });

  app.get('/api/admin/pickup/summary', pickupGuard, async (request, reply) => {
    try {
      const query = request.query as PickupOrdersQuery;
      const range = dayRange(query.date);
      const where: Prisma.OrderWhereInput = { created_at: { gte: range.start, lt: range.end }, ...(query.pickup_store_id ? { pickup_store_id: query.pickup_store_id } : {}) };
      const orders = await prisma.order.findMany({ where: { ...where, order_status: { in: [OrderStatus.paid, OrderStatus.ready, OrderStatus.picked, OrderStatus.completed] } }, select: { order_status: true, quantity: true } });
      return ok({ date: range.date, pickup_store_id: query.pickup_store_id ?? null, pending_count: orders.filter((order) => order.order_status === OrderStatus.paid).length, ready_count: orders.filter((order) => order.order_status === OrderStatus.ready).length, picked_count: orders.filter((order) => order.order_status === OrderStatus.picked).length, completed_count: orders.filter((order) => order.order_status === OrderStatus.completed).length, total_quantity: orders.reduce((sum, order) => sum + order.quantity, 0) });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '自提概览查询失败');
    }
  });
}
