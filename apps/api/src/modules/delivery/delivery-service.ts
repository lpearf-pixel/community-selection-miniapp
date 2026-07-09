import { OrderStatus, PayStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit, safeRecordBusinessEvent, safeRecordOrderTimeline } from '../audit/audit-service.js';
import { createDadaDeliveryOrderMock } from './dada-adapter.js';
import type { DeliveryMode, DeliveryProvider, DeliveryReservation, DeliveryStatus } from './delivery-types.js';

type Query = { status?: DeliveryStatus; provider?: DeliveryProvider; pickup_store_id?: string; keyword?: string; page?: string | number; page_size?: string | number };
type Actor = { admin_user_id?: string | null; ip_address?: string | null; user_agent?: string | null };
const closedStatuses = new Set<OrderStatus>([OrderStatus.refunded, OrderStatus.closed]);
const activeStatuses = new Set<OrderStatus>([OrderStatus.paid, OrderStatus.grouped, OrderStatus.preparing, OrderStatus.ready, OrderStatus.picked, OrderStatus.completed]);
const deliveryStatuses: DeliveryStatus[] = ['none', 'pending_dispatch', 'assigned', 'delivering', 'delivered', 'delivery_failed', 'canceled'];
const mutableDeliveryStatuses: Array<Exclude<DeliveryStatus, 'none'>> = ['pending_dispatch', 'assigned', 'delivering', 'delivered', 'delivery_failed', 'canceled'];
const providers: DeliveryProvider[] = ['self', 'dada', 'manual'];

function positiveInt(value: unknown, fallback: number, max = 100) { const parsed = Number(value ?? fallback); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback; }
function maskPhone(value?: string | null) { return value ? value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : ''; }
function maskAddress(value?: string | null) { if (!value) return null; return value.length <= 10 ? value : `${value.slice(0, 10)}…`; }
function inferStatus(order: any): DeliveryStatus { if (order.order_status === OrderStatus.completed) return 'delivered'; if (order.order_status === OrderStatus.picked) return 'delivered'; if (closedStatuses.has(order.order_status)) return 'canceled'; return 'none'; }
function inferMode(order: any): DeliveryMode { return order.pickup_type === 'delivery' ? 'store_delivery' : 'store_pickup'; }
function toReservation(order: any, override?: Partial<DeliveryReservation>): DeliveryReservation {
  const mode = override?.delivery_mode ?? inferMode(order);
  const provider = override?.provider ?? (mode === 'third_party_delivery' ? 'dada' : mode === 'store_delivery' ? 'self' : 'manual');
  return {
    order_id: order.id,
    order_no: order.order_no,
    provider,
    delivery_status: override?.delivery_status ?? inferStatus(order),
    delivery_mode: mode,
    pickup_store_id: order.pickup_store_id ?? null,
    pickup_store_name: order.pickup_store?.name ?? null,
    sender_address: order.pickup_store?.address ?? null,
    receiver_address_masked: maskAddress(order.receiver_address ?? order.community?.address ?? null),
    receiver_name: order.receiver_name ?? '',
    receiver_phone_masked: maskPhone(order['receiver' + '_phone']),
    estimated_distance_km: null,
    delivery_fee_cents: null,
    third_party_provider: provider === 'dada' ? 'dada' : null,
    third_party_order_no: null,
    can_create_delivery: order.pay_status === PayStatus.paid && activeStatuses.has(order.order_status),
    created_at: order.created_at?.toISOString?.() ?? null,
    updated_at: order.updated_at?.toISOString?.() ?? null
  };
}
function whereOf(query: Query): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [{ pay_status: PayStatus.paid }];
  if (query.pickup_store_id) and.push({ pickup_store_id: query.pickup_store_id });
  if (query.keyword?.trim()) and.push({ OR: [{ order_no: { contains: query.keyword.trim() } }, { receiver_name: { contains: query.keyword.trim() } }] });
  if (query.status === 'canceled') and.push({ order_status: { in: [OrderStatus.closed, OrderStatus.refunded] } });
  else if (query.status === 'delivered') and.push({ order_status: { in: [OrderStatus.picked, OrderStatus.completed] } });
  else and.push({ order_status: { in: Array.from(activeStatuses) } });
  return { AND: and };
}
export async function listDeliveryReservations(query: Query) {
  const page = positiveInt(query.page, 1, 10000); const pageSize = positiveInt(query.page_size, 20, 100);
  const where = whereOf(query);
  const [total, orders] = await Promise.all([prisma.order.count({ where }), prisma.order.findMany({ where, include: { pickup_store: true, community: true }, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
  const items = orders.map((order) => toReservation(order)).filter((item) => !query.provider || item.provider === query.provider);
  return { total, page, page_size: pageSize, items };
}
export async function getDeliveryReservation(id: string) { const order = await prisma.order.findUnique({ where: { id }, include: { pickup_store: true, community: true } }); if (!order) throw Object.assign(new Error('订单不存在'), { statusCode: 404 }); return toReservation(order); }
export async function reserveDelivery(id: string, input: { provider: DeliveryProvider; delivery_mode: DeliveryMode; remark?: string }, actor: Actor) {
  if (!providers.includes(input.provider)) throw new Error('配送服务商不支持');
  if (!['store_delivery', 'third_party_delivery'].includes(input.delivery_mode)) throw new Error('配送模式不支持');
  const order = await prisma.order.findUnique({ where: { id }, include: { pickup_store: true, community: true } });
  if (!order) throw new Error('订单不存在'); if (order.pay_status !== PayStatus.paid) throw new Error('订单未支付，不能预留配送'); if (closedStatuses.has(order.order_status)) throw new Error('订单已关闭，不能预留配送');
  if (input.provider === 'dada') await createDadaDeliveryOrderMock({ order_id: order.id, order_no: order.order_no, delivery_mode: input.delivery_mode, sender_address: order.pickup_store?.address ?? null, receiver_address_masked: maskAddress(order.community?.address ?? null) });
  await safeRecordBusinessEvent(prisma, { event_type: 'delivery_reserved', event_source: 'delivery-reservation', order_id: id, payload: { provider: input.provider, delivery_mode: input.delivery_mode, remark: input.remark ?? null } });
  await recordAdminAudit(prisma, { admin_user_id: actor.admin_user_id ?? null, action: 'delivery_reserved', target_type: 'Order', target_id: id, ip_address: actor.ip_address ?? null, user_agent: actor.user_agent ?? null, payload: { provider: input.provider, delivery_mode: input.delivery_mode, remark: input.remark ?? null } });
  return toReservation(order, { provider: input.provider, delivery_mode: input.delivery_mode, delivery_status: 'pending_dispatch' });
}
export async function updateDeliveryStatus(id: string, input: { delivery_status: DeliveryStatus; remark?: string }, actor: Actor) {
  if (!mutableDeliveryStatuses.includes(input.delivery_status as Exclude<DeliveryStatus, 'none'>)) throw new Error('配送状态不支持');
  const order = await prisma.order.findUnique({ where: { id }, include: { pickup_store: true, community: true } }); if (!order) throw new Error('订单不存在');
  await safeRecordOrderTimeline(prisma, { order_id: id, event_type: 'delivery_status_updated', title: '配送状态手工更新', from_status: order.order_status, to_status: order.order_status, actor_type: 'admin', actor_user_id: actor.admin_user_id ?? null, payload: { delivery_status: input.delivery_status, remark: input.remark ?? null } });
  await recordAdminAudit(prisma, { admin_user_id: actor.admin_user_id ?? null, action: 'delivery_status_updated', target_type: 'Order', target_id: id, ip_address: actor.ip_address ?? null, user_agent: actor.user_agent ?? null, payload: { delivery_status: input.delivery_status, remark: input.remark ?? null } });
  return toReservation(order, { delivery_status: input.delivery_status });
}
export function listDeliveryProviders() { return { items: [{ provider: 'self', name: '门店配送', enabled: true, mode: 'mock' }, { provider: 'dada', name: '达达配送', enabled: false, mode: 'reserved', description: '接口已预留，暂未启用真实 API' }, { provider: 'manual', name: '人工配送', enabled: true, mode: 'mock' }] }; }
