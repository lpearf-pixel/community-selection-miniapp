import type { FastifyRequest } from 'fastify';
import { prisma } from '../../db.js';
import { createAfterSaleCase } from '../after-sale/after-sale-service.js';
import { getDeliveryRule } from '../delivery/delivery-rule-service.js';

type QueryLike = { user_id?: string; openid?: string };
type UserOrderQuery = { status?: string; type?: string; page?: string | number; page_size?: string | number };
type AfterSaleInput = { type?: string; reason?: string; description?: string; requested_refund_cents?: number; evidence_image_urls?: string[] };

const orderInclude = {
  product: true,
  group_buy: { include: { product: true } },
  pickup_store: true,
  community: true,
  after_sale_cases: { orderBy: { created_at: 'desc' as const } }
};

function asString(value: unknown) {
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
}

export async function resolveUserIdentity(request: FastifyRequest) {
  const query = request.query as QueryLike;
  const userId = asString(request.headers['x-user-id']) ?? asString(query.user_id);
  const openid = asString(request.headers['x-openid']) ?? asString(query.openid);
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    return user;
  }
  if (openid) {
    const user = await prisma.user.findUnique({ where: { openid } });
    if (!user) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    return user;
  }
  throw Object.assign(new Error('缺少用户身份'), { statusCode: 401 });
}

function productOf(order: any) {
  return order.group_buy?.product ?? order.product;
}

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function pickupCode(orderNo: string) {
  return `PICK-${orderNo.slice(-6)}`;
}

export function maskReceiverPhone(phone: string) {
  return phone.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}

export function toUserOrderStatus(order: any) {
  if (order.refund_status === 'success' || order.order_status === 'refunded') return '已退款';
  if (order.after_sale_cases?.some((item: any) => ['submitted', 'reviewing', 'approved', 'processing'].includes(item.status))) return '售后中';
  if (order.pay_status === 'unpaid') return '待支付';
  if (order.pay_status === 'closed' || order.order_status === 'closed') return '已关闭';
  if (order.order_status === 'completed') return '已完成';
  if (order.order_status === 'picked') return '已自提';
  if (order.order_status === 'ready') return '待自提';
  if (order.order_status === 'preparing') return '备货中';
  if (order.order_status === 'grouped' || order.group_buy?.status === 'success') return '已成团';
  return '已支付';
}

function fulfillmentText(order: any) { return order.pickup_type === 'delivery' ? '门店配送' : '到店自提'; }
function deliveryStatusText(order: any) {
  if (order.order_status === 'preparing') return '备货中';
  if (order.order_status === 'delivered') return '已送达';
  if (order.order_status === 'completed') return '已完成';
  if (order.order_status === 'ready' || order.order_status === 'paid') return '待配送';
  return order.pickup_type === 'delivery' ? '待配送' : null;
}

function mapAfterSale(item: any) {
  return {
    after_sale_case_id: item.id,
    id: item.id,
    type: item.type,
    status: item.status,
    resolution_type: item.resolution_type,
    reason: item.reason,
    description: item.description,
    requested_refund_cents: item.requested_refund_cents,
    approved_refund_cents: item.approved_refund_cents,
    responsibility: item.responsibility,
    created_at: item.created_at.toISOString(),
    resolved_at: iso(item.resolved_at)
  };
}

function listItem(order: any) {
  const product = productOf(order);
  const latestAfterSale = order.after_sale_cases?.[0];
  return {
    order_id: order.id,
    order_no: order.order_no,
    order_type: order.group_buy_id ? 'group_buy' : 'normal',
    product_id: product?.id ?? null,
    product_name: product?.name ?? '',
    product_cover_image: product?.cover_image ?? null,
    product: product ? { product_id: product.id, name: product.name, cover_image: product.cover_image ?? null } : null,
    quantity: order.quantity,
    total_amount_cents: order.total_amount_cents,
    pay_amount_cents: order.pay_amount_cents,
    refund_amount_cents: order.refund_amount_cents,
    pay_status: order.pay_status,
    order_status: order.order_status,
    user_status_text: toUserOrderStatus(order),
    refund_status: order.refund_status,
    group_buy_id: order.group_buy_id,
    group_buy_status: order.group_buy?.status ?? null,
    pickup_type: order.pickup_type,
    fulfillment_type_text: fulfillmentText(order),
    delivery_status_text: deliveryStatusText(order),
    delivery_fee_cents: order.pickup_type === 'delivery' ? getDeliveryRule().base_fee_cents : 0,
    delivery_time_window_text: order.pickup_type === 'delivery' ? '以门店确认时段为准' : null,
    service_radius_text: order.pickup_type === 'delivery' ? getDeliveryRule().service_radius_text : null,
    receiver_address: order.pickup_type === 'delivery' ? order.receiver_address : null,
    pickup_store_name: order.pickup_store?.name ?? null,
    pickup: { pickup_store_id: order.pickup_store_id, pickup_store_name: order.pickup_store?.name ?? null, pickup_store_address: order.pickup_store?.address ?? null, pickup_store_phone: order.pickup_store?.phone ?? null },
    community_name: order.community?.name ?? null,
    created_at: order.created_at.toISOString(),
    paid_at: iso(order.paid_at),
    completed_at: iso(order.completed_at),
    after_sale_case_count: order.after_sale_cases?.length ?? 0,
    latest_after_sale_status: latestAfterSale?.status ?? null,
    after_sale_summary: { has_after_sale: (order.after_sale_cases?.length ?? 0) > 0, latest_status: latestAfterSale?.status ?? null }
  };
}

export async function listUserOrders(userId: string, query: UserOrderQuery) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 20) || 20));
  const where: any = { user_id: userId };
  if (query.status === 'unpaid') where.pay_status = 'unpaid';
  else if (query.status === 'refunded') where.OR = [{ refund_status: 'success' }, { order_status: 'refunded' }];
  else if (query.status && query.status !== 'all' && query.status !== 'after_sale') where.order_status = query.status;
  if (query.type === 'normal') where.group_buy_id = null;
  if (query.type === 'group_buy') where.group_buy_id = { not: null };
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: orderInclude, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
  ]);
  return { total, page, page_size: pageSize, items: orders.map(listItem) };
}

async function ownedOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, user_id: userId }, include: orderInclude });
  if (!order) throw Object.assign(new Error('订单不存在'), { statusCode: 404 });
  return order;
}

export async function getUserOrderDetail(userId: string, orderId: string) {
  const order = await ownedOrder(userId, orderId);
  const product = productOf(order);
  const timeline = await prisma.orderTimelineLog.findMany({ where: { order_id: order.id }, orderBy: { created_at: 'asc' } });
  return {
    ...listItem(order),
    product: product ? { product_id: product.id, name: product.name, cover_image: product.cover_image, price_cents: product.price_cents, sale_unit: product.sale_unit, sale_spec_name: product.sale_spec_name } : null,
    group_buy: order.group_buy ? { group_buy_id: order.group_buy.id, status: order.group_buy.status, min_people: order.group_buy.min_people, current_people: order.group_buy.current_people, end_time: order.group_buy.end_time.toISOString() } : null,
    pickup: { pickup_type: order.pickup_type, fulfillment_type_text: fulfillmentText(order), pickup_store_id: order.pickup_store_id, pickup_store_name: order.pickup_store?.name ?? null, pickup_store_address: order.pickup_store?.address ?? null, pickup_store_phone: order.pickup_store?.phone ?? null, pickup_code: pickupCode(order.order_no) },
    delivery: { delivery_status_text: deliveryStatusText(order), delivery_fee_cents: order.pickup_type === 'delivery' ? getDeliveryRule().base_fee_cents : 0, delivery_time_window_text: order.pickup_type === 'delivery' ? '以门店确认时段为准' : null, service_radius_text: order.pickup_type === 'delivery' ? getDeliveryRule().service_radius_text : null, notice: order.pickup_type === 'delivery' ? getDeliveryRule().notice : null, receiver_address: order.pickup_type === 'delivery' ? order.receiver_address : null },
    receiver: { receiver_name: order.receiver_name, receiver_phone_masked: maskReceiverPhone(order.receiver_phone), receiver_address: order.receiver_address },
    after_sales: order.after_sale_cases.map(mapAfterSale),
    timeline: timeline.length > 0 ? timeline.map((item) => ({ event_type: item.event_type, title: item.title, from_status: item.from_status, to_status: item.to_status, created_at: item.created_at.toISOString() })) : [{ event_type: 'order_status', title: toUserOrderStatus(order), to_status: order.order_status, created_at: order.created_at.toISOString() }]
  };
}

export async function listUserOrderAfterSales(userId: string, orderId: string) {
  await ownedOrder(userId, orderId);
  const cases = await prisma.afterSaleCase.findMany({ where: { order_id: orderId }, orderBy: { created_at: 'desc' } });
  return cases.map(mapAfterSale);
}

export async function createUserOrderAfterSale(userId: string, orderId: string, body: AfterSaleInput) {
  await ownedOrder(userId, orderId);
  if (!body.type || !body.reason) throw Object.assign(new Error('缺少售后必填字段'), { statusCode: 400 });
  const afterSaleCase = await createAfterSaleCase({ order_id: orderId, user_id: userId, type: body.type, reason: body.reason, description: body.description ?? null, requested_refund_cents: body.requested_refund_cents ?? null, evidence_image_urls: body.evidence_image_urls ?? null });
  return mapAfterSale(afterSaleCase);
}

export async function getUserOrderPickupCode(userId: string, orderId: string) {
  const order = await ownedOrder(userId, orderId);
  if (order.pay_status !== 'paid') throw Object.assign(new Error('未支付订单不可查看自提凭证'), { statusCode: 400 });
  return { order_id: order.id, order_no: order.order_no, pickup_code: pickupCode(order.order_no), pickup_status: order.order_status, pickup_store_name: order.pickup_store?.name ?? null, pickup_store_address: order.pickup_store?.address ?? null, pickup_store_phone: order.pickup_store?.phone ?? null, receiver_name: order.receiver_name, receiver_phone_masked: maskReceiverPhone(order.receiver_phone) };
}
