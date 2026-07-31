import { prisma } from '../../db.js';
import { publicCurrentUserError } from '../current-user/current-user-security.js';
import { createAfterSaleCase } from '../after-sale/after-sale-service.js';

export type UserOrderQuery = {
  status?: string;
  type?: string;
  page?: string | number;
  page_size?: string | number;
};

export type UserAfterSaleSubmission = {
  type?: string;
  reason?: string;
  description?: string;
  evidence_image_urls?: string[];
  requested_product_refund_cents?: number;
};

const orderInclude = {
  product: true,
  group_buy: { include: { product: true } },
  pickup_store: true,
  community: true,
  after_sale_cases: { orderBy: { created_at: 'desc' as const } },
};

const USER_AFTER_SALE_BAD_REQUEST_MESSAGES = new Set([
  '售后类型不合法',
  '缺少售后必填字段',
  '申请退款金额必须大于 0',
  '申请商品退款金额必须大于 0',
  '申请配送费退款金额必须大于 0',
  '申请配送费退款金额必须为非负整数分',
  '配送费是否退还由商家审核决定',
  '申请商品退款金额与配送费退款金额之和必须等于总退款金额',
  '商品退款金额与配送费退款金额之和必须等于总退款金额',
  '商品退款金额超过商品可退金额',
  '配送费退款金额超过配送费可退金额',
  '退款金额超过订单实付金额',
  '订单没有可退金额',
  '订单没有可退商品金额',
  '退款金额超过订单剩余可退金额',
  '售后凭证必须是图片 URL 字符串数组',
]);

const USER_AFTER_SALE_NOT_FOUND_MESSAGES = new Set([
  '订单不存在',
  '售后商品不存在',
]);

const USER_AFTER_SALE_CONFLICT_MESSAGES = new Set([
  '当前订单状态不可提交售后',
  '同一订单商品问题已有处理中售后',
]);

function rethrowPublicUserAfterSaleError(error: unknown): never {
  if (!(error instanceof Error)) throw error;
  if (USER_AFTER_SALE_BAD_REQUEST_MESSAGES.has(error.message)) {
    throw publicCurrentUserError(error.message, 400);
  }
  if (USER_AFTER_SALE_NOT_FOUND_MESSAGES.has(error.message)) {
    throw publicCurrentUserError(error.message, 404);
  }
  if (error.message === '不能为无关订单提交售后') {
    throw publicCurrentUserError(error.message, 403);
  }
  if (USER_AFTER_SALE_CONFLICT_MESSAGES.has(error.message)) {
    throw publicCurrentUserError(error.message, 409);
  }
  throw error;
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

export function maskReceiverName(value?: string | null) {
  return value ? `${value.slice(0, 1)}*` : null;
}

export function maskReceiverPhone(value?: string | null) {
  return value ? value.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2') : null;
}

export function maskReceiverAddress(value?: string | null) {
  if (!value) return null;
  return value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-2)}` : '***';
}

export function toUserOrderStatus(order: any) {
  if (order.refund_status === 'success' || order.order_status === 'refunded') return '已退款';
  if (
    order.after_sale_cases?.some((item: any) =>
      ['submitted', 'reviewing', 'approved', 'processing'].includes(item.status),
    )
  ) {
    return '售后中';
  }
  if (order.pay_status === 'unpaid') return '待支付';
  if (order.pay_status === 'closed' || order.order_status === 'closed') return '已关闭';
  if (order.order_status === 'completed') return '已完成';
  if (order.order_status === 'picked') return '已自提';
  if (order.order_status === 'ready') return '待自提';
  if (order.order_status === 'preparing') return '备货中';
  if (order.order_status === 'grouped' || order.group_buy?.status === 'success') return '已成团';
  return '已支付';
}

function fulfillmentText(order: any) {
  return order.pickup_type === 'delivery' ? '门店配送' : '到店自提';
}

const deliveryStatusLabels: Record<string, string> = {
  pending_dispatch: '待配送',
  delivering: '配送中',
  delivered: '已送达',
  exception: '配送异常',
};

function isoValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function promiseSnapshot(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function toUserFulfillment(order: {
  pickup_type: string;
  order_status: string;
  delivery_status?: string | null;
  fulfillment_promise_snapshot?: unknown;
  promised_fulfillment_start_at?: Date | string | null;
  promised_fulfillment_end_at?: Date | string | null;
}) {
  const snapshot = promiseSnapshot(order.fulfillment_promise_snapshot);
  const fulfillmentPromise = {
    display_text:
      typeof snapshot?.display_text === 'string'
        ? snapshot.display_text
        : '历史订单未保存承诺时段',
    promised_start_at: isoValue(order.promised_fulfillment_start_at),
    promised_end_at: isoValue(order.promised_fulfillment_end_at),
    snapshot,
  };
  if (order.pickup_type === 'delivery') {
    const status =
      order.delivery_status ??
      (['delivered', 'completed'].includes(order.order_status)
        ? 'delivered'
        : 'pending_dispatch');
    return {
      fulfillment_status: status,
      fulfillment_status_text: deliveryStatusLabels[status] ?? '待配送',
      fulfillment_promise: fulfillmentPromise,
    };
  }

  if (order.order_status === 'picked' || order.order_status === 'completed') {
    return {
      fulfillment_status: 'picked_up',
      fulfillment_status_text: '已自提',
      fulfillment_promise: fulfillmentPromise,
    };
  }
  if (order.order_status === 'ready') {
    return {
      fulfillment_status: 'ready_for_pickup',
      fulfillment_status_text: '待自提',
      fulfillment_promise: fulfillmentPromise,
    };
  }
  return {
    fulfillment_status: 'preparing_pickup',
    fulfillment_status_text: '备货中',
    fulfillment_promise: fulfillmentPromise,
  };
}

function deliveryStatusText(order: any) {
  return order.pickup_type === 'delivery'
    ? toUserFulfillment(order).fulfillment_status_text
    : null;
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
    requested_product_refund_cents: item.requested_product_refund_cents,
    requested_delivery_refund_cents: item.requested_delivery_refund_cents,
    approved_refund_cents: item.approved_refund_cents,
    approved_product_refund_cents: item.approved_product_refund_cents,
    approved_delivery_refund_cents: item.approved_delivery_refund_cents,
    responsibility: item.responsibility,
    created_at: item.created_at.toISOString(),
    resolved_at: iso(item.resolved_at),
  };
}

function listItem(order: any) {
  const product = productOf(order);
  const latestAfterSale = order.after_sale_cases?.[0];
  const fulfillment = toUserFulfillment(order);
  return {
    order_id: order.id,
    order_no: order.order_no,
    order_type: order.group_buy_id ? 'group_buy' : 'normal',
    product_id: product?.id ?? null,
    product_name: product?.name ?? '',
    product_cover_image: product?.cover_image ?? null,
    product: product
      ? {
          product_id: product.id,
          name: product.name,
          cover_image: product.cover_image ?? null,
        }
      : null,
    quantity: order.quantity,
    total_amount_cents: order.total_amount_cents,
    product_amount_cents: order.product_amount_cents ?? order.total_amount_cents,
    delivery_fee_cents: order.delivery_fee_cents ?? 0,
    pay_amount_cents: order.pay_amount_cents,
    refund_amount_cents: order.refund_amount_cents,
    product_refund_amount_cents: order.product_refund_amount_cents,
    delivery_refund_amount_cents: order.delivery_refund_amount_cents,
    remaining_refundable_amount_cents: Math.max(
      0,
      order.pay_amount_cents - order.refund_amount_cents,
    ),
    remaining_product_refundable_amount_cents: Math.max(
      0,
      (order.product_amount_cents ?? order.total_amount_cents) -
        order.product_refund_amount_cents,
    ),
    remaining_delivery_refundable_amount_cents: Math.max(
      0,
      (order.delivery_fee_cents ?? 0) - order.delivery_refund_amount_cents,
    ),
    pay_status: order.pay_status,
    order_status: order.order_status,
    user_status_text: toUserOrderStatus(order),
    refund_status: order.refund_status,
    group_buy_id: order.group_buy_id,
    group_buy_status: order.group_buy?.status ?? null,
    pickup_type: order.pickup_type,
    fulfillment_type_text: fulfillmentText(order),
    ...fulfillment,
    delivery_status_text: deliveryStatusText(order),
    delivery_time_window_code:
      order.pickup_type === 'delivery'
        ? (order.delivery_time_window_code ?? null)
        : null,
    delivery_time_window_text:
      order.pickup_type === 'delivery'
        ? (order.delivery_time_window_text ?? '以门店确认时段为准')
        : null,
    service_radius_text:
      order.pickup_type === 'delivery'
        ? '门店周边 3-5km，具体以门店确认为准'
        : null,
    receiver_address_masked:
      order.pickup_type === 'delivery'
        ? maskReceiverAddress(order.receiver_address)
        : null,
    pickup_store_name: order.pickup_store?.name ?? null,
    pickup: {
      pickup_store_id: order.pickup_store_id,
      pickup_store_name: order.pickup_store?.name ?? null,
      pickup_store_address: order.pickup_store?.address ?? null,
      pickup_store_phone: order.pickup_store?.phone ?? null,
    },
    community_name: order.community?.name ?? null,
    created_at: order.created_at.toISOString(),
    paid_at: iso(order.paid_at),
    completed_at: iso(order.completed_at),
    after_sale_case_count: order.after_sale_cases?.length ?? 0,
    latest_after_sale_status: latestAfterSale?.status ?? null,
    after_sale_summary: {
      has_after_sale: (order.after_sale_cases?.length ?? 0) > 0,
      latest_status: latestAfterSale?.status ?? null,
    },
  };
}

export async function listUserOrders(userId: string, query: UserOrderQuery) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 20) || 20));
  const where: any = { user_id: userId };
  if (query.status === 'unpaid') where.pay_status = 'unpaid';
  else if (query.status === 'refunded') {
    where.OR = [{ refund_status: 'success' }, { order_status: 'refunded' }];
  } else if (query.status && query.status !== 'all' && query.status !== 'after_sale') {
    where.order_status = query.status;
  }
  if (query.type === 'normal') where.group_buy_id = null;
  if (query.type === 'group_buy') where.group_buy_id = { not: null };
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, page, page_size: pageSize, items: orders.map(listItem) };
}

async function ownedOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, user_id: userId },
    include: orderInclude,
  });
  if (!order) throw publicCurrentUserError('订单不存在', 404);
  return order;
}

export async function getUserOrderDetail(userId: string, orderId: string) {
  const order = await ownedOrder(userId, orderId);
  const product = productOf(order);
  const timeline = await prisma.orderTimelineLog.findMany({
    where: { order_id: order.id },
    orderBy: { created_at: 'asc' },
  });
  return {
    ...listItem(order),
    product: product
      ? {
          product_id: product.id,
          name: product.name,
          cover_image: product.cover_image,
          price_cents: product.price_cents,
          sale_unit: product.sale_unit,
          sale_spec_name: product.sale_spec_name,
        }
      : null,
    group_buy: order.group_buy
      ? {
          group_buy_id: order.group_buy.id,
          status: order.group_buy.status,
          min_people: order.group_buy.min_people,
          current_people: order.group_buy.current_people,
          end_time: order.group_buy.end_time.toISOString(),
        }
      : null,
    pickup: {
      pickup_type: order.pickup_type,
      fulfillment_type_text: fulfillmentText(order),
      pickup_store_id: order.pickup_store_id,
      pickup_store_name: order.pickup_store?.name ?? null,
      pickup_store_address: order.pickup_store?.address ?? null,
      pickup_store_phone: order.pickup_store?.phone ?? null,
      pickup_code: pickupCode(order.order_no),
    },
    refund_split: {
      product_refund_amount_cents: order.product_refund_amount_cents,
      delivery_refund_amount_cents: order.delivery_refund_amount_cents,
      total_refund_amount_cents: order.refund_amount_cents,
      remaining_refundable_amount_cents: Math.max(
        0,
        order.pay_amount_cents - order.refund_amount_cents,
      ),
    },
    delivery: {
      delivery_status_text: deliveryStatusText(order),
      delivery_status: order.delivery_status ?? null,
      fulfillment_status: toUserFulfillment(order).fulfillment_status,
      fulfillment_status_text:
        toUserFulfillment(order).fulfillment_status_text,
      fulfillment_promise: toUserFulfillment(order).fulfillment_promise,
      delivery_fee_cents: order.delivery_fee_cents ?? 0,
      delivery_time_window_code:
        order.pickup_type === 'delivery'
          ? (order.delivery_time_window_code ?? null)
          : null,
      delivery_time_window_text:
        order.pickup_type === 'delivery'
          ? (order.delivery_time_window_text ?? '以门店确认时段为准')
          : null,
      service_radius_text:
        order.pickup_type === 'delivery'
          ? '门店周边 3-5km，具体以门店确认为准'
          : null,
      notice:
        order.pickup_type === 'delivery'
          ? '当前为门店配送，暂不接第三方配送。配送范围与时段以门店确认为准。'
          : null,
      receiver_address_masked:
        order.pickup_type === 'delivery'
          ? maskReceiverAddress(order.receiver_address)
          : null,
    },
    receiver: {
      receiver_name_masked: maskReceiverName(order.receiver_name),
      receiver_phone_masked: maskReceiverPhone(order.receiver_phone),
      receiver_address_masked: maskReceiverAddress(order.receiver_address),
    },
    after_sales: order.after_sale_cases.map(mapAfterSale),
    timeline:
      timeline.length > 0
        ? timeline.map((item) => ({
            event_type: item.event_type,
            title: item.title,
            from_status: item.from_status,
            to_status: item.to_status,
            created_at: item.created_at.toISOString(),
          }))
        : [
            {
              event_type: 'order_status',
              title: toUserOrderStatus(order),
              to_status: order.order_status,
              created_at: order.created_at.toISOString(),
            },
          ],
  };
}

export async function listUserOrderAfterSales(userId: string, orderId: string) {
  await ownedOrder(userId, orderId);
  const cases = await prisma.afterSaleCase.findMany({
    where: { order_id: orderId },
    orderBy: { created_at: 'desc' },
  });
  return cases.map(mapAfterSale);
}

export function resolveUserRequestedProductRefundCents(
  order: {
    product_amount_cents?: number | null;
    total_amount_cents: number;
    product_refund_amount_cents: number;
  },
  requestedProductRefundCents?: number,
) {
  const remainingProductRefundCents = Math.max(
    0,
    (order.product_amount_cents ?? order.total_amount_cents) -
      order.product_refund_amount_cents,
  );
  const resolvedAmount =
    requestedProductRefundCents ?? remainingProductRefundCents;
  if (remainingProductRefundCents <= 0) {
    throw new Error('订单没有可退商品金额');
  }
  return resolvedAmount;
}

export async function createUserOrderAfterSale(
  userId: string,
  orderId: string,
  body: UserAfterSaleSubmission,
) {
  const order = await ownedOrder(userId, orderId);
  if (!body.type || !body.reason) {
    throw publicCurrentUserError('缺少售后必填字段', 400);
  }
  try {
    const requestedProductRefundCents =
      resolveUserRequestedProductRefundCents(
        order,
        body.requested_product_refund_cents,
      );
    const afterSaleCase = await createAfterSaleCase({
      order_id: orderId,
      user_id: userId,
      type: body.type,
      reason: body.reason,
      description: body.description ?? null,
      evidence_image_urls: body.evidence_image_urls ?? null,
      requested_refund_cents: requestedProductRefundCents,
      requested_product_refund_cents: requestedProductRefundCents,
      requested_delivery_refund_cents: 0,
    });
    return mapAfterSale(afterSaleCase);
  } catch (error) {
    rethrowPublicUserAfterSaleError(error);
  }
}

export async function getUserOrderPickupCode(userId: string, orderId: string) {
  const order = await ownedOrder(userId, orderId);
  if (order.pay_status !== 'paid') {
    throw publicCurrentUserError('未支付订单不可查看自提凭证', 400);
  }
  return {
    order_id: order.id,
    order_no: order.order_no,
    pickup_code: pickupCode(order.order_no),
    pickup_status: order.order_status,
    pickup_store_name: order.pickup_store?.name ?? null,
    pickup_store_address: order.pickup_store?.address ?? null,
    pickup_store_phone: order.pickup_store?.phone ?? null,
    receiver_name_masked: maskReceiverName(order.receiver_name),
    receiver_phone_masked: maskReceiverPhone(order.receiver_phone),
  };
}
