export const ADMIN_ORDER_CHANNEL = {
  code: 'wechat_miniapp',
  label: '微信小程序',
  source: 'historical_default',
} as const;

const ORDER_TYPES = ['normal', 'group_buy'] as const;
const PICKUP_TYPES = ['store', 'delivery'] as const;
const PAY_STATUSES = ['unpaid', 'paid', 'failed', 'closed'] as const;
const ORDER_STATUSES = [
  'unpaid',
  'paid',
  'grouped',
  'preparing',
  'ready',
  'picked',
  'delivered',
  'completed',
  'refunding',
  'refunded',
  'closed',
] as const;
const REFUND_STATUSES = [
  'none',
  'pending',
  'approved',
  'processing',
  'success',
  'failed',
  'rejected',
] as const;

export const MAX_ADMIN_ORDER_PAGE = 10_000;

export type AdminOrderListQuery = {
  keyword?: string;
  order_type?: (typeof ORDER_TYPES)[number];
  pickup_type?: (typeof PICKUP_TYPES)[number];
  pay_status?: (typeof PAY_STATUSES)[number];
  order_status?: (typeof ORDER_STATUSES)[number];
  refund_status?: (typeof REFUND_STATUSES)[number];
  page: number;
  page_size: number;
};

export type AdminOrderListQueryResult =
  | { ok: true; value: AdminOrderListQuery }
  | {
      ok: false;
      code: 'INVALID_ADMIN_ORDER_QUERY';
      message: string;
    };

type PublicProductSource = {
  id: string;
  name: string;
  cover_image?: string | null;
  price_cents: number;
  sale_unit: string;
  sale_spec_name?: string | null;
};

type AdminOrderListRecord = {
  id: string;
  order_no: string;
  user_id: string;
  group_buy_id?: string | null;
  product_id?: string | null;
  quantity: number;
  total_amount_cents: number;
  pay_amount_cents: number;
  refund_amount_cents: number;
  pay_status: string;
  order_status: string;
  version: number;
  refund_status: string;
  pickup_type: string;
  receiver_name: string;
  receiver_phone?: string | null;
  receiver_address?: string | null;
  created_at: Date | string;
  paid_at?: Date | string | null;
  user?: { id: string; nickname: string } | null;
  product?: PublicProductSource | null;
  group_buy?: {
    id?: string;
    product?: PublicProductSource | null;
    community?: { id: string; name: string } | null;
  } | null;
  pickup_store?: {
    id: string;
    name: string;
    address: string;
  } | null;
  community?: { id: string; name: string } | null;
  wechat_shipping_intent?: {
    status:
      | 'pending'
      | 'processing'
      | 'retryable'
      | 'succeeded'
      | 'manual_required';
    attempt_count: number;
    last_error_code: string | null;
    next_retry_at: Date | string | null;
    succeeded_at: Date | string | null;
  } | null;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function enumValue<const T extends readonly string[]>(
  input: Record<string, unknown>,
  field: string,
  allowed: T,
): T[number] | undefined | null {
  const value = stringValue(input[field]);
  if (!value) return undefined;
  return allowed.includes(value) ? (value as T[number]) : null;
}

function positiveInteger(
  value: unknown,
  fallback: number,
): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const text = typeof value === 'number' ? String(value) : stringValue(value);
  if (!text || !/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function invalid(field: string, detail = `Unsupported ${field}`) {
  return {
    ok: false,
    code: 'INVALID_ADMIN_ORDER_QUERY',
    message: detail,
  } as const;
}

export function parseAdminOrderListQuery(
  input: Record<string, unknown>,
): AdminOrderListQueryResult {
  const page = positiveInteger(input.page, 1);
  if (page === null) return invalid('page', 'page must be a positive integer');
  if (page > MAX_ADMIN_ORDER_PAGE) {
    return invalid(
      'page',
      `page must not exceed ${MAX_ADMIN_ORDER_PAGE}`,
    );
  }
  const requestedPageSize = positiveInteger(input.page_size, 20);
  if (requestedPageSize === null) {
    return invalid('page_size', 'page_size must be a positive integer');
  }

  const orderType = enumValue(input, 'order_type', ORDER_TYPES);
  if (orderType === null) return invalid('order_type');
  const pickupType = enumValue(input, 'pickup_type', PICKUP_TYPES);
  if (pickupType === null) return invalid('pickup_type');
  const payStatus = enumValue(input, 'pay_status', PAY_STATUSES);
  if (payStatus === null) return invalid('pay_status');
  const orderStatus = enumValue(input, 'order_status', ORDER_STATUSES);
  if (orderStatus === null) return invalid('order_status');
  const refundStatus = enumValue(input, 'refund_status', REFUND_STATUSES);
  if (refundStatus === null) return invalid('refund_status');

  const keyword = stringValue(input.keyword);
  if (keyword && keyword.length > 100) {
    return invalid('keyword', 'keyword must not exceed 100 characters');
  }

  return {
    ok: true,
    value: {
      ...(keyword ? { keyword } : {}),
      ...(orderType ? { order_type: orderType } : {}),
      ...(pickupType ? { pickup_type: pickupType } : {}),
      ...(payStatus ? { pay_status: payStatus } : {}),
      ...(orderStatus ? { order_status: orderStatus } : {}),
      ...(refundStatus ? { refund_status: refundStatus } : {}),
      page,
      page_size: Math.min(requestedPageSize, 100),
    },
  };
}

export function buildAdminOrderListWhere(
  query: AdminOrderListQuery,
  scopeWhere: Record<string, unknown>,
): Record<string, unknown> {
  const filters: Record<string, unknown>[] = [scopeWhere];
  if (query.order_type === 'group_buy') {
    filters.push({ group_buy_id: { not: null } });
  }
  if (query.order_type === 'normal') filters.push({ group_buy_id: null });
  if (query.pickup_type) filters.push({ pickup_type: query.pickup_type });
  if (query.pay_status) filters.push({ pay_status: query.pay_status });
  if (query.order_status) filters.push({ order_status: query.order_status });
  if (query.refund_status) {
    filters.push({ refund_status: query.refund_status });
  }
  if (query.keyword) {
    filters.push({
      OR: [
        {
          order_no: {
            contains: query.keyword,
            mode: 'insensitive',
          },
        },
        {
          receiver_name: {
            contains: query.keyword,
            mode: 'insensitive',
          },
        },
        { receiver_phone: { contains: query.keyword } },
      ],
    });
  }
  return { AND: filters };
}

function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  if (/^\d{11}$/.test(phone)) {
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
  if (phone.length <= 2) return '*'.repeat(phone.length);
  return `${phone.slice(0, 1)}***${phone.slice(-1)}`;
}

function maskAddress(address?: string | null): string | null {
  if (!address) return null;
  return `${address.slice(0, 6)}***`;
}

function publicProduct(product?: PublicProductSource | null) {
  return product
    ? {
        product_id: product.id,
        name: product.name,
        cover_image: product.cover_image ?? null,
        price_cents: product.price_cents,
        sale_unit: product.sale_unit,
        sale_spec_name: product.sale_spec_name ?? null,
      }
    : null;
}

export function toAdminOrderListItem(order: AdminOrderListRecord) {
  const product = order.product ?? order.group_buy?.product ?? null;
  const community = order.community ?? order.group_buy?.community ?? null;
  return {
    id: order.id,
    order_no: order.order_no,
    order_type: order.group_buy_id ? 'group_buy' : 'normal',
    channel: ADMIN_ORDER_CHANNEL,
    user: order.user
      ? { id: order.user.id, nickname: order.user.nickname }
      : { id: order.user_id, nickname: '-' },
    product: publicProduct(product),
    quantity: order.quantity,
    total_amount_cents: order.total_amount_cents,
    pay_amount_cents: order.pay_amount_cents,
    refund_amount_cents: order.refund_amount_cents,
    pay_status: order.pay_status,
    order_status: order.order_status,
    version: order.version,
    refund_status: order.refund_status,
    pickup_type: order.pickup_type,
    pickup_store: order.pickup_store
      ? {
          pickup_store_id: order.pickup_store.id,
          name: order.pickup_store.name,
          address: order.pickup_store.address,
        }
      : null,
    community: community
      ? { community_id: community.id, name: community.name }
      : null,
    receiver_name: order.receiver_name,
    receiver_phone_masked: maskPhone(order.receiver_phone),
    receiver_address_masked: maskAddress(order.receiver_address),
    shipping_sync: order.wechat_shipping_intent
      ? {
          status: order.wechat_shipping_intent.status,
          attempts: order.wechat_shipping_intent.attempt_count,
          last_error_code:
            order.wechat_shipping_intent.last_error_code,
          next_retry_at:
            order.wechat_shipping_intent.next_retry_at,
          succeeded_at:
            order.wechat_shipping_intent.succeeded_at,
        }
      : {
          status: 'not_applicable' as const,
          attempts: 0,
          last_error_code: null,
          next_retry_at: null,
          succeeded_at: null,
        },
    created_at: order.created_at,
    paid_at: order.paid_at ?? null,
  };
}
