import { OrderStatus, PickupType, type Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { lockStockForOrder } from '../inventory/inventory-service.js';
import { recordAdminAudit, safeRecordBusinessEvent, safeRecordOrderTimeline } from '../audit/audit-service.js';
import { markCommissionPendingForCompletedOrder } from '../finance/finance-service.js';
import { deliveryTimeWindowText, getDeliveryRule, validateDeliveryRuleForOrder } from '../delivery/delivery-rule-service.js';

type CreateGroupOrderInput = {
  group_buy_id?: string;
  user_id?: string;
  user_openid?: string;
  client_request_id?: string;
  quantity?: number;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  pickup_type?: string;
  pickup_store_id?: string;
  delivery_time_window_code?: string;
  community_id?: string;
  credit_amount_cents?: number;
  credit_source_id?: string;
};


type CreateNormalOrderInput = {
  product_id?: string;
  user_id?: string;
  user_openid?: string;
  client_request_id?: string;
  quantity?: number;
  pickup_store_id?: string;
  delivery_time_window_code?: string;
  community_id?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  pickup_type?: string;
};

type AdminMeta = { admin_user_id?: string | null; ip_address?: string | null; user_agent?: string | null };

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function makeOrderNo() {
  return `O${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

const allowedFulfillmentStatuses = new Set<OrderStatus>([
  OrderStatus.preparing,
  OrderStatus.ready,
  OrderStatus.picked,
  OrderStatus.delivered,
  OrderStatus.completed
]);

function normalizePickupType(value: unknown): PickupType {
  if (value === PickupType.delivery) return PickupType.delivery;
  return PickupType.store;
}

function validateFulfillment(input: { pickup_type?: string; pickup_store_id?: string; receiver_name?: string; receiver_phone?: string; receiver_address?: string; delivery_time_window_code?: string }) {
  const pickupType = normalizePickupType(input.pickup_type);
  if (!input.pickup_store_id?.trim()) throw new Error('自提点必填校验：请选择自提点');
  if (pickupType === PickupType.delivery) {
    const result = validateDeliveryRuleForOrder(input);
    if (!result.ok) throw new Error(result.error_message || '配送规则校验失败');
  }
  return pickupType;
}

function normalizeNextStatus(value: unknown): OrderStatus {
  if (!value || typeof value !== 'string') throw new Error('缺少订单目标状态');
  if (!allowedFulfillmentStatuses.has(value as OrderStatus)) throw new Error('订单目标状态不合法');
  return value as OrderStatus;
}

async function findUserIdByOpenid(openid: string, fallbackNickname: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { openid },
    update: {},
    create: { openid, nickname: fallbackNickname, role: 'customer' }
  });
  return user.id;
}


function maskReceiverPhone(phone?: string | null) {
  if (!phone) return null;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

function toPublicOrder(order: any, deliveryMeta?: { delivery_fee_cents?: number; delivery_time_window_text?: string }) {
  // L36 门店配送响应展示配送时段与配送费；配送时段不落库，创建响应优先使用本次校验结果。
  const product = order.product ?? order.group_buy?.product ?? null;
  return {
    id: order.id,
    order_id: order.id,
    order_no: order.order_no,
    client_request_id: order.client_request_id,
    user_id: order.user_id,
    group_buy_id: order.group_buy_id,
    product_id: order.product_id ?? product?.id ?? null,
    leader_user_id: order.leader_user_id,
    total_amount_cents: order.total_amount_cents,
    pay_amount_cents: order.pay_amount_cents,
    refund_amount_cents: order.refund_amount_cents,
    quantity: order.quantity,
    pay_status: order.pay_status,
    order_status: order.order_status,
    refund_status: order.refund_status,
    pickup_type: order.pickup_type,
    pickup_store_id: order.pickup_store_id,
    community_id: order.community_id,
    receiver_name: order.receiver_name,
    receiver_phone_masked: maskReceiverPhone(order.receiver_phone),
    receiver_address: order.receiver_address,
    receiver_address_masked: order.receiver_address ? `${String(order.receiver_address).slice(0, 6)}***` : null,
    delivery_fee_cents: order.pickup_type === 'delivery' ? (deliveryMeta?.delivery_fee_cents ?? getDeliveryRule().base_fee_cents) : 0,
    delivery_time_window_text: order.pickup_type === 'delivery' ? (deliveryMeta?.delivery_time_window_text ?? '以门店确认时段为准') : null,
    service_radius_text: order.pickup_type === 'delivery' ? getDeliveryRule().service_radius_text : null,
    created_at: order.created_at,
    paid_at: order.paid_at,
    completed_at: order.completed_at,
    product: product
      ? {
          product_id: product.id,
          name: product.name,
          cover_image: product.cover_image,
          price_cents: product.price_cents,
          sale_unit: product.sale_unit,
          sale_spec_name: product.sale_spec_name
        }
      : null,
    pickup_store: order.pickup_store
      ? {
          pickup_store_id: order.pickup_store.id,
          name: order.pickup_store.name,
          address: order.pickup_store.address,
          phone: order.pickup_store.phone
        }
      : null,
    community: order.community
      ? {
          community_id: order.community.id,
          name: order.community.name,
          address: order.community.address
        }
      : null
  };
}

async function getCreditBalance(tx: Prisma.TransactionClient, userId: string) {
  const entries = await tx.consumerCreditLedger.findMany({ where: { user_id: userId } });
  return entries.reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount_cents : -entry.amount_cents), 0);
}

export async function createGroupOrder(input: CreateGroupOrderInput) {
  const saleQuantity = positiveInt(input.quantity, 1);
  const userId = input.user_id ?? (input.user_openid ? await findUserIdByOpenid(input.user_openid, input.receiver_name ?? '社区用户') : undefined);
  if (!userId || !input.group_buy_id || !input.client_request_id || !input.receiver_name || !input.receiver_phone) throw new Error('缺少下单必填字段');
  const groupBuyId = input.group_buy_id;
  const clientRequestId = input.client_request_id;
  const receiverName = input.receiver_name;
  const receiverPhone = input.receiver_phone;
  const pickupType = validateFulfillment({ pickup_type: input.pickup_type, pickup_store_id: input.pickup_store_id, receiver_name: input.receiver_name, receiver_phone: input.receiver_phone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code });
  const deliveryValidation = pickupType === 'delivery' ? validateDeliveryRuleForOrder({ pickup_store_id: input.pickup_store_id, receiver_name: input.receiver_name, receiver_phone: input.receiver_phone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code }) : null;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.order.findUnique({
      where: { client_request_id: clientRequestId },
      include: { group_buy: { include: { product: true } }, pickup_store: true, community: true }
    });
    if (existing) {
      await safeRecordBusinessEvent(tx, { event_type: 'order_idempotent_reused', event_source: 'order-service', order_id: existing.id, idempotency_key: clientRequestId, after_snapshot: existing });
      return toPublicOrder(existing);
    }

    const groupBuy = await tx.groupBuy.findUnique({ where: { id: groupBuyId }, include: { product: true } });
    if (!groupBuy) throw new Error('团购不存在');
    if (groupBuy.status !== 'pending' && groupBuy.status !== 'success') throw new Error('当前团购不可下单');
    if (groupBuy.end_time.getTime() <= Date.now()) throw new Error('团购已截止');

    const amount = groupBuy.price_cents * saleQuantity;
    const creditAmount = Number(input.credit_amount_cents ?? 0);
    if (!Number.isInteger(creditAmount) || creditAmount < 0) throw new Error('消费额度抵扣金额不合法');
    if (creditAmount > amount) throw new Error('消费额度抵扣金额不能超过订单金额');
    if (creditAmount > 0 && !input.credit_source_id) throw new Error('缺少消费额度来源');

    let creditBalanceAfter: number | null = null;
    if (creditAmount > 0) {
      const conversion = await tx.rewardConversion.findUnique({ where: { id: input.credit_source_id } });
      if (!conversion || conversion.status !== 'success' || conversion.conversion_type !== 'credit' || conversion.leader_user_id !== userId) throw new Error('消费额度来源不可用');
      const currentCreditBalance = await getCreditBalance(tx, userId);
      if (currentCreditBalance < creditAmount) throw new Error('消费额度余额不足');
      creditBalanceAfter = currentCreditBalance - creditAmount;
    }

    const order = await tx.order.create({
      data: {
        order_no: makeOrderNo(),
        client_request_id: clientRequestId,
        user_id: userId,
        group_buy_id: groupBuy.id,
        leader_user_id: groupBuy.leader_user_id,
        total_amount_cents: amount,
        pay_amount_cents: amount - creditAmount,
        quantity: saleQuantity,
        credit_amount_cents: creditAmount,
        credit_source_type: creditAmount > 0 ? 'reward_conversion' : undefined,
        credit_source_id: creditAmount > 0 ? input.credit_source_id : undefined,
        pickup_type: pickupType,
        pickup_store_id: input.pickup_store_id,
        community_id: input.community_id ?? groupBuy.community_id,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        receiver_address: input.receiver_address
      },
      include: { group_buy: { include: { product: true } }, pickup_store: true, community: true }
    });

    const stockLock = await lockStockForOrder(tx, { product_id: groupBuy.product_id, sale_quantity: saleQuantity, user_id: userId, order_id: order.id, group_buy_id: groupBuy.id, client_request_id: clientRequestId });
    await safeRecordBusinessEvent(tx, { event_type: 'order_stock_decremented', event_source: 'order-service', group_buy_id: groupBuy.id, idempotency_key: clientRequestId, payload: { product_id: groupBuy.product_id, sale_quantity: saleQuantity, stock_quantity: stockLock.stock_quantity } });

    if (creditAmount > 0) {
      await tx.consumerCreditLedger.create({ data: { user_id: userId, source_type: 'order_payment', source_id: order.id, direction: 'out', amount_cents: creditAmount, balance_after_cents: creditBalanceAfter ?? 0, usable_scope: 'platform_order', remark: '订单使用平台消费额度抵扣', payload: { credit_source_type: 'reward_conversion', credit_source_id: input.credit_source_id } } });
      await safeRecordBusinessEvent(tx, { event_type: 'order_credit_used', event_source: 'order-service', order_id: order.id, user_id: userId, payload: { credit_amount_cents: creditAmount, credit_source_id: input.credit_source_id, balance_after_cents: creditBalanceAfter } });
    }

    await safeRecordOrderTimeline(tx, { order_id: order.id, event_type: 'order_created', title: '订单已创建', to_status: order.order_status, actor_type: 'user', actor_user_id: userId, payload: { group_buy_id: groupBuy.id, quantity: saleQuantity } });
    await safeRecordBusinessEvent(tx, { event_type: 'order_created', event_source: 'order-service', order_id: order.id, group_buy_id: groupBuy.id, user_id: userId, idempotency_key: clientRequestId, after_snapshot: order });
    return toPublicOrder(order, deliveryValidation ? { delivery_fee_cents: deliveryValidation.delivery_fee_cents, delivery_time_window_text: deliveryTimeWindowText(deliveryValidation.delivery_time_window) } : undefined);
  });
}


export async function createNormalOrder(input: CreateNormalOrderInput) {
  const saleQuantity = positiveInt(input.quantity, 1);
  const productId = input.product_id?.trim();
  const receiverName = input.receiver_name?.trim();
  const receiverPhone = input.receiver_phone?.trim();
  const userId = input.user_id ?? (input.user_openid ? await findUserIdByOpenid(input.user_openid, receiverName ?? '社区用户') : undefined);
  const clientRequestId = input.client_request_id ?? `normal-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  if (!userId || !productId || !receiverName || !receiverPhone) throw new Error('缺少普通购买下单必填字段');
  const pickupType = validateFulfillment({ pickup_type: input.pickup_type, pickup_store_id: input.pickup_store_id, receiver_name: receiverName, receiver_phone: receiverPhone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code });
  const deliveryValidation = pickupType === 'delivery' ? validateDeliveryRuleForOrder({ pickup_store_id: input.pickup_store_id, receiver_name: receiverName, receiver_phone: receiverPhone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code }) : null;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.order.findUnique({
      where: { client_request_id: clientRequestId },
      include: { product: true, pickup_store: true, community: true }
    });
    if (existing) return toPublicOrder(existing);

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error('商品不存在');
    if (product.status !== 'active') throw new Error('商品不可购买');
    const stockDeductQuantity = Math.max(1, product.stock_deduct_quantity ?? 1);
    if (product.stock < saleQuantity * stockDeductQuantity) throw new Error('库存不足');
    if (input.community_id) {
      const community = await tx.community.findUnique({ where: { id: input.community_id } });
      if (!community) throw new Error('社区不存在');
    }
    if (input.pickup_store_id) {
      const pickupStore = await tx.pickupStore.findUnique({ where: { id: input.pickup_store_id } });
      if (!pickupStore) throw new Error('自提点不存在');
    }

    const amount = product.price_cents * saleQuantity;
    const order = await tx.order.create({
      data: {
        order_no: makeOrderNo(),
        client_request_id: clientRequestId,
        user_id: userId,
        group_buy_id: null,
        product_id: product.id,
        total_amount_cents: amount,
        pay_amount_cents: amount,
        quantity: saleQuantity,
        pickup_type: pickupType,
        pickup_store_id: input.pickup_store_id,
        community_id: input.community_id,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        receiver_address: input.receiver_address
      },
      include: { product: true, pickup_store: true, community: true }
    });

    await safeRecordOrderTimeline(tx, { order_id: order.id, event_type: 'order_created', title: '普通购买订单已创建', to_status: order.order_status, actor_type: 'user', actor_user_id: userId, payload: { product_id: product.id, quantity: saleQuantity } });
    await safeRecordBusinessEvent(tx, { event_type: 'normal_order_created', event_source: 'order-service', order_id: order.id, user_id: userId, idempotency_key: clientRequestId, after_snapshot: order });
    return toPublicOrder(order, deliveryValidation ? { delivery_fee_cents: deliveryValidation.delivery_fee_cents, delivery_time_window_text: deliveryTimeWindowText(deliveryValidation.delivery_time_window) } : undefined);
  });
}

export async function updateOrderStatus(input: { order_id: string; next_status?: string; admin_meta?: AdminMeta }) {
  const nextStatus = normalizeNextStatus(input.next_status);
  const order = await prisma.order.findUnique({ where: { id: input.order_id } });
  if (!order) throw new Error('订单不存在');
  if (order.pay_status !== 'paid') throw new Error('未支付订单不可推进履约');
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const isCompleted = nextStatus === OrderStatus.completed;
    const updatedOrder = await tx.order.update({ where: { id: input.order_id }, data: { order_status: nextStatus, completed_at: isCompleted ? new Date() : undefined } });
    await safeRecordBusinessEvent(tx, { event_type: isCompleted ? 'order_completed' : 'order_status_changed', event_source: 'order-service', order_id: input.order_id, before_snapshot: order, after_snapshot: updatedOrder, payload: { from_status: order.order_status, to_status: nextStatus } });
    await recordAdminAudit(tx, { admin_user_id: input.admin_meta?.admin_user_id ?? null, action: isCompleted ? 'order_completed' : 'order_status_changed', target_type: 'Order', target_id: input.order_id, ip_address: input.admin_meta?.ip_address ?? null, user_agent: input.admin_meta?.user_agent ?? null, payload: { from_status: order.order_status, to_status: nextStatus } });
    await safeRecordOrderTimeline(tx, { order_id: input.order_id, event_type: isCompleted ? 'order_completed' : 'order_status_changed', title: isCompleted ? '订单已完成' : '订单状态已更新', from_status: order.order_status, to_status: nextStatus, payload: { from_status: order.order_status, to_status: nextStatus } });
    if (isCompleted) await markCommissionPendingForCompletedOrder(input.order_id, tx);
    return updatedOrder;
  });
}

export async function pickupVerify(input: { order_id: string; admin_user_id?: string | null; ip_address?: string | null; user_agent?: string | null; admin_remark?: string | null }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.order.findUnique({ where: { id: input.order_id } });
    if (!existing) throw new Error('订单不存在');
    if (existing.order_status === 'picked') return existing;
    if (['refunded', 'closed', 'completed'].includes(existing.order_status)) throw new Error('当前订单不可核销自提');
    if (existing.order_status !== 'ready') throw new Error('当前订单不可核销自提');
    const updated = await tx.order.update({ where: { id: input.order_id }, data: { order_status: 'picked' } });
    await safeRecordOrderTimeline(tx, { order_id: input.order_id, event_type: 'pickup_verified', title: '自提已核销', from_status: existing.order_status, to_status: 'picked', actor_type: 'admin', actor_user_id: input.admin_user_id ?? null, payload: { admin_remark: input.admin_remark ?? null } });
    await safeRecordBusinessEvent(tx, { event_type: 'pickup_verified', event_source: 'order-service', order_id: input.order_id, before_snapshot: existing, after_snapshot: updated, payload: { admin_remark: input.admin_remark ?? null } });
    await recordAdminAudit(tx, { admin_user_id: input.admin_user_id ?? null, action: 'order_pickup_verified', target_type: 'Order', target_id: input.order_id, ip_address: input.ip_address ?? null, user_agent: input.user_agent ?? null, payload: { admin_remark: input.admin_remark ?? null } });
    return updated;
  });
}
