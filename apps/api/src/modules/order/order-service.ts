import { OrderStatus, PickupType, type Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit, safeRecordBusinessEvent, safeRecordOrderTimeline } from '../audit/audit-service.js';
import { markCommissionPendingForCompletedOrder } from '../finance/finance-service.js';
import { deliveryTimeWindowText, getDeliveryRule, validateDeliveryRuleForOrder } from '../delivery/delivery-rule-service.js';
import { buildFulfillmentPromise } from '../fulfillment/fulfillment-promise.js';
import { quoteMemberPrice } from '../membership/member-pricing.js';
import { getMembershipEntitlement } from '../membership/membership-repository.js';

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

export class OrderRequestError extends Error {
  readonly statusCode = 400;
}

function orderRequestError(message: string) {
  return new OrderRequestError(message);
}

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
  OrderStatus.delivered,
  OrderStatus.completed
]);

function normalizePickupType(value: unknown): PickupType {
  if (value === PickupType.delivery) return PickupType.delivery;
  return PickupType.store;
}

async function validateFulfillment(input: { pickup_type?: string; pickup_store_id?: string; receiver_name?: string; receiver_phone?: string; receiver_address?: string; delivery_time_window_code?: string }) {
  const pickupType = normalizePickupType(input.pickup_type);
  // L35: 自提点必填校验
  if (!input.pickup_store_id?.trim()) throw orderRequestError('自提点必填校验：请选择自提点');
  if (pickupType === PickupType.delivery) {
    // L35: 收货人必填校验
    // L35: 手机号必填校验
    // L35: 配送地址必填校验
    const result = await validateDeliveryRuleForOrder(input);
    if (!result.ok) throw orderRequestError(result.error_message || '配送规则校验失败');
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

function fulfillmentPromiseRuleSource(rule: {
  id?: string;
  updated_at?: Date;
}) {
  return typeof rule.id === 'string' && rule.updated_at instanceof Date
    ? { id: rule.id, updated_at: rule.updated_at }
    : undefined;
}

function toPublicOrder(order: any, deliveryMeta?: { delivery_fee_cents?: number; delivery_time_window_text?: string; service_radius_text?: string }) {
  // L38: product_amount_cents 为商品金额，delivery_fee_cents 为配送费，pay_amount_cents 为应付金额；不接真实支付/退款。
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
    product_amount_cents: order.product_amount_cents ?? order.total_amount_cents,
    delivery_fee_cents: order.delivery_fee_cents ?? (order.pickup_type === 'delivery' ? (deliveryMeta?.delivery_fee_cents ?? 0) : 0),
    pay_amount_cents: order.pay_amount_cents,
    unit_price_cents: order.unit_price_cents ?? null,
    price_source: order.price_source ?? null,
    pricing_snapshot: order.pricing_snapshot ?? null,
    membership_period_id: order.membership_period_id ?? null,
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
    delivery_time_window_code: order.pickup_type === 'delivery' ? (order.delivery_time_window_code ?? null) : null,
    delivery_time_window_text: order.pickup_type === 'delivery' ? (order.delivery_time_window_text ?? deliveryMeta?.delivery_time_window_text ?? '以门店确认时段为准') : null,
    delivery_status: order.delivery_status ?? null,
    delivery_status_updated_at: order.delivery_status_updated_at ?? null,
    fulfillment_promise_snapshot: order.fulfillment_promise_snapshot ?? null,
    promised_fulfillment_start_at: order.promised_fulfillment_start_at ?? null,
    promised_fulfillment_end_at: order.promised_fulfillment_end_at ?? null,
    service_radius_text: order.pickup_type === 'delivery' ? (deliveryMeta?.service_radius_text ?? null) : null,
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
  if (!userId || !input.group_buy_id || !input.client_request_id || !input.receiver_name || !input.receiver_phone) throw orderRequestError('缺少下单必填字段');
  const groupBuyId = input.group_buy_id;
  const clientRequestId = input.client_request_id;
  const receiverName = input.receiver_name;
  const receiverPhone = input.receiver_phone;
  const pickupType = await validateFulfillment({ pickup_type: input.pickup_type, pickup_store_id: input.pickup_store_id, receiver_name: input.receiver_name, receiver_phone: input.receiver_phone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code });

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
    if (!groupBuy) throw orderRequestError('团购不存在');
    if (groupBuy.status !== 'pending' && groupBuy.status !== 'success') throw orderRequestError('当前团购不可下单');
    if (groupBuy.end_time.getTime() <= Date.now()) throw orderRequestError('团购已截止');

    const membership = await getMembershipEntitlement(userId, new Date(), tx);
    const priceQuote = quoteMemberPrice({
      enabled: process.env.MEMBERSHIP_ENABLED === 'true' && groupBuy.product.member_pricing_enabled,
      channel: 'group',
      listPriceCents: groupBuy.product.price_cents,
      channelPriceCents: groupBuy.price_cents,
      costPriceCents: groupBuy.product.cost_price_cents,
      memberDiscountBps: groupBuy.product.member_discount_bps,
      groupMemberDiscountBps: groupBuy.product.group_member_discount_bps,
      minimumMarginBps: groupBuy.product.minimum_member_margin_bps,
      minimumMarginCents: groupBuy.product.minimum_member_margin_cents,
      ruleVersion: groupBuy.product.member_pricing_rule_version,
      membership: membership.active
        ? { active: true, accountId: membership.accountId, periodId: membership.periodId }
        : { active: false },
    });
    const productAmountCents = priceQuote.unitPriceCents * saleQuantity;
    const deliveryValidation = pickupType === 'delivery' ? await validateDeliveryRuleForOrder({ pickup_store_id: input.pickup_store_id, receiver_name: input.receiver_name, receiver_phone: input.receiver_phone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code, order_amount_cents: productAmountCents }) : null;
    const deliveryFeeCents = pickupType === 'delivery' ? (deliveryValidation?.delivery_fee_cents ?? 0) : 0;
    const payAmountCentsBeforeCredit = productAmountCents + deliveryFeeCents;
    const deliveryTimeWindowTextValue = pickupType === 'delivery' && deliveryValidation?.delivery_time_window ? deliveryTimeWindowText(deliveryValidation.delivery_time_window) : null;
    const capturedAt = new Date();
    const fulfillmentPromise =
      pickupType === PickupType.delivery && deliveryValidation?.delivery_time_window
        ? buildFulfillmentPromise({
            kind: 'delivery',
            capturedAt,
            window: deliveryValidation.delivery_time_window,
            sourceRule: fulfillmentPromiseRuleSource(
              deliveryValidation.delivery_rule,
            ),
          })
        : buildFulfillmentPromise({
            kind: 'group_buy_pickup',
            capturedAt,
            pickupTime: groupBuy.pickup_time,
          });
    const amount = productAmountCents;
    const creditAmount = Number(input.credit_amount_cents ?? 0);
    if (!Number.isInteger(creditAmount) || creditAmount < 0) throw orderRequestError('消费额度抵扣金额不合法');
    if (creditAmount > productAmountCents) throw orderRequestError('消费额度抵扣金额不能超过商品金额');
    if (creditAmount > 0 && !input.credit_source_id) throw orderRequestError('缺少消费额度来源');

    let creditBalanceAfter: number | null = null;
    if (creditAmount > 0) {
      const conversion = await tx.rewardConversion.findUnique({ where: { id: input.credit_source_id } });
      if (!conversion || conversion.status !== 'success' || conversion.conversion_type !== 'credit' || conversion.leader_user_id !== userId) throw orderRequestError('消费额度来源不可用');
      const currentCreditBalance = await getCreditBalance(tx, userId);
      if (currentCreditBalance < creditAmount) throw orderRequestError('消费额度余额不足');
      creditBalanceAfter = currentCreditBalance - creditAmount;
    }

    const order = await tx.order.create({
      data: {
        order_no: makeOrderNo(),
        client_request_id: clientRequestId,
        user_id: userId,
        group_buy_id: groupBuy.id,
        leader_user_id: groupBuy.leader_user_id,
        total_amount_cents: productAmountCents,
        product_amount_cents: productAmountCents,
        delivery_fee_cents: deliveryFeeCents,
        delivery_time_window_code: pickupType === PickupType.delivery ? input.delivery_time_window_code : null,
        delivery_time_window_text: deliveryTimeWindowTextValue,
        delivery_status:
          pickupType === PickupType.delivery ? 'pending_dispatch' : null,
        delivery_status_updated_at:
          pickupType === PickupType.delivery ? capturedAt : null,
        ...fulfillmentPromise,
        pay_amount_cents: payAmountCentsBeforeCredit - creditAmount,
        unit_price_cents: priceQuote.unitPriceCents,
        price_source: priceQuote.priceSource,
        pricing_snapshot: priceQuote,
        membership_period_id: priceQuote.membershipPeriodId,
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

    if (creditAmount > 0) {
      await tx.consumerCreditLedger.create({ data: { user_id: userId, source_type: 'order_payment', source_id: order.id, direction: 'out', amount_cents: creditAmount, balance_after_cents: creditBalanceAfter ?? 0, usable_scope: 'platform_order', remark: '订单使用平台消费额度抵扣', payload: { credit_source_type: 'reward_conversion', credit_source_id: input.credit_source_id } } });
      await safeRecordBusinessEvent(tx, { event_type: 'order_credit_used', event_source: 'order-service', order_id: order.id, user_id: userId, payload: { credit_amount_cents: creditAmount, credit_source_id: input.credit_source_id, balance_after_cents: creditBalanceAfter } });
    }

    await safeRecordOrderTimeline(tx, { order_id: order.id, event_type: 'order_created', title: '订单已创建', to_status: order.order_status, actor_type: 'user', actor_user_id: userId, payload: { group_buy_id: groupBuy.id, quantity: saleQuantity } });
    await safeRecordBusinessEvent(tx, { event_type: 'order_created', event_source: 'order-service', order_id: order.id, group_buy_id: groupBuy.id, user_id: userId, idempotency_key: clientRequestId, after_snapshot: order });
    return toPublicOrder(order, deliveryValidation ? { delivery_fee_cents: deliveryValidation.delivery_fee_cents, delivery_time_window_text: deliveryTimeWindowText(deliveryValidation.delivery_time_window), service_radius_text: (await getDeliveryRule({ pickup_store_id: input.pickup_store_id })).service_radius_text } : undefined);
  });
}


export async function createNormalOrder(input: CreateNormalOrderInput) {
  const saleQuantity = positiveInt(input.quantity, 1);
  const productId = input.product_id?.trim();
  const receiverName = input.receiver_name?.trim();
  const receiverPhone = input.receiver_phone?.trim();
  const userId = input.user_id ?? (input.user_openid ? await findUserIdByOpenid(input.user_openid, receiverName ?? '社区用户') : undefined);
  const clientRequestId = input.client_request_id ?? `normal-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  if (!userId || !productId || !receiverName || !receiverPhone) throw orderRequestError('缺少普通购买下单必填字段');
  const pickupType = await validateFulfillment({ pickup_type: input.pickup_type, pickup_store_id: input.pickup_store_id, receiver_name: receiverName, receiver_phone: receiverPhone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code });

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.order.findUnique({
      where: { client_request_id: clientRequestId },
      include: { product: true, pickup_store: true, community: true }
    });
    if (existing) return toPublicOrder(existing);

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw orderRequestError('商品不存在');
    if (product.status !== 'active') throw orderRequestError('商品不可购买');
    if (input.community_id) {
      const community = await tx.community.findUnique({ where: { id: input.community_id } });
      if (!community) throw orderRequestError('社区不存在');
    }
    if (input.pickup_store_id) {
      const pickupStore = await tx.pickupStore.findUnique({ where: { id: input.pickup_store_id } });
      if (!pickupStore) throw orderRequestError('自提点不存在');
    }

    const membership = await getMembershipEntitlement(userId, new Date(), tx);
    const priceQuote = quoteMemberPrice({
      enabled: process.env.MEMBERSHIP_ENABLED === 'true' && product.member_pricing_enabled,
      channel: 'regular',
      listPriceCents: product.price_cents,
      channelPriceCents: product.price_cents,
      costPriceCents: product.cost_price_cents,
      memberDiscountBps: product.member_discount_bps,
      groupMemberDiscountBps: product.group_member_discount_bps,
      minimumMarginBps: product.minimum_member_margin_bps,
      minimumMarginCents: product.minimum_member_margin_cents,
      ruleVersion: product.member_pricing_rule_version,
      membership: membership.active
        ? { active: true, accountId: membership.accountId, periodId: membership.periodId }
        : { active: false },
    });
    const productAmountCents = priceQuote.unitPriceCents * saleQuantity;
    const deliveryValidation = pickupType === 'delivery' ? await validateDeliveryRuleForOrder({ pickup_store_id: input.pickup_store_id, receiver_name: receiverName, receiver_phone: receiverPhone, receiver_address: input.receiver_address, delivery_time_window_code: input.delivery_time_window_code, order_amount_cents: productAmountCents }) : null;
    const deliveryFeeCents = pickupType === 'delivery' ? (deliveryValidation?.delivery_fee_cents ?? 0) : 0;
    const deliveryTimeWindowTextValue = pickupType === 'delivery' && deliveryValidation?.delivery_time_window ? deliveryTimeWindowText(deliveryValidation.delivery_time_window) : null;
    const capturedAt = new Date();
    const fulfillmentPromise =
      pickupType === PickupType.delivery && deliveryValidation?.delivery_time_window
        ? buildFulfillmentPromise({
            kind: 'delivery',
            capturedAt,
            window: deliveryValidation.delivery_time_window,
            sourceRule: fulfillmentPromiseRuleSource(
              deliveryValidation.delivery_rule,
            ),
          })
        : buildFulfillmentPromise({
            kind: 'normal_pickup',
            capturedAt,
          });
    const amount = productAmountCents;
    const order = await tx.order.create({
      data: {
        order_no: makeOrderNo(),
        client_request_id: clientRequestId,
        user_id: userId,
        group_buy_id: null,
        product_id: product.id,
        total_amount_cents: productAmountCents,
        product_amount_cents: productAmountCents,
        delivery_fee_cents: deliveryFeeCents,
        delivery_time_window_code: pickupType === PickupType.delivery ? input.delivery_time_window_code : null,
        delivery_time_window_text: deliveryTimeWindowTextValue,
        delivery_status:
          pickupType === PickupType.delivery ? 'pending_dispatch' : null,
        delivery_status_updated_at:
          pickupType === PickupType.delivery ? capturedAt : null,
        ...fulfillmentPromise,
        pay_amount_cents: productAmountCents + deliveryFeeCents,
        unit_price_cents: priceQuote.unitPriceCents,
        price_source: priceQuote.priceSource,
        pricing_snapshot: priceQuote,
        membership_period_id: priceQuote.membershipPeriodId,
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
    return toPublicOrder(order, deliveryValidation ? { delivery_fee_cents: deliveryValidation.delivery_fee_cents, delivery_time_window_text: deliveryTimeWindowText(deliveryValidation.delivery_time_window), service_radius_text: (await getDeliveryRule({ pickup_store_id: input.pickup_store_id })).service_radius_text } : undefined);
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
