type ApiResponse<T> = {
  success: boolean;
  data: T;
  message: string;
};

type ListResponse<T> = {
  items: T[];
  total?: number;
  page?: number;
  page_size?: number;
};

type IdLike = {
  id?: string;
  product_id?: string;
  community_id?: string;
  pickup_store_id?: string;
  order_id?: string;
  after_sale_case_id?: string;
};

const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://127.0.0.1:13080').replace(/\/$/, '');
const forbiddenResponseFields = ['cost_price_cents', 'commission_value', 'stock_deduct_quantity'];
const receiverPhone = '13812345678';
const openid = `docker-e2e-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoForbiddenFields(value: unknown, context: string): void {
  const serialized = JSON.stringify(value);
  for (const field of forbiddenResponseFields) {
    assert(!serialized.includes(`\"${field}\"`), `${context} response must not expose ${field}`);
  }
}

function assertNoFullReceiverPhone(value: unknown, context: string): void {
  assert(!JSON.stringify(value).includes(receiverPhone), `${context} response must not expose receiver_phone ${receiverPhone}`);
}

async function request<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let parsed: ApiResponse<T>;
  try {
    parsed = JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new Error(`${method} ${path} returned non-JSON response (${response.status}): ${text}`);
  }
  assert(response.ok, `${method} ${path} failed with HTTP ${response.status}: ${parsed.message}`);
  assert(parsed.success === true, `${method} ${path} must return success=true: ${parsed.message}`);
  assertNoForbiddenFields(parsed, `${method} ${path}`);
  return parsed.data;
}

function firstItem<T>(list: ListResponse<T>, label: string): T {
  assert(Array.isArray(list.items), `${label} response must contain items[]`);
  assert(list.items.length > 0, `${label} response must contain at least one item`);
  return list.items[0];
}

function idOf(item: IdLike, keys: Array<keyof IdLike>, label: string): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  throw new Error(`${label} response item does not include a usable id`);
}

async function main() {
  await request('GET', '/api/health');

  const products = await request<ListResponse<IdLike>>('GET', '/api/products?page_size=1&only_in_stock=true');
  const productId = idOf(firstItem(products, 'GET /api/products'), ['product_id', 'id'], 'GET /api/products');

  const communities = await request<ListResponse<IdLike>>('GET', '/api/communities?page_size=1');
  const communityId = idOf(firstItem(communities, 'GET /api/communities'), ['community_id', 'id'], 'GET /api/communities');

  const pickupStores = await request<ListResponse<IdLike>>('GET', '/api/pickup-stores?page_size=1');
  const pickupStoreId = idOf(firstItem(pickupStores, 'GET /api/pickup-stores'), ['pickup_store_id', 'id'], 'GET /api/pickup-stores');

  const order = await request<IdLike>('POST', '/api/orders/normal', {
    body: {
      product_id: productId,
      user_openid: openid,
      client_request_id: `docker-e2e-normal-${Date.now()}`,
      quantity: 1,
      pickup_store_id: pickupStoreId,
      community_id: communityId,
      receiver_name: 'Docker E2E 用户',
      receiver_phone: receiverPhone
    }
  });
  assertNoForbiddenFields(order, 'POST /api/orders/normal');
  assertNoFullReceiverPhone(order, 'POST /api/orders/normal');
  const orderId = idOf(order, ['order_id', 'id'], 'POST /api/orders/normal');

  await request('POST', '/api/payments/mock', { body: { order_id: orderId } });

  const userHeaders = { 'x-openid': openid };
  const orderList = await request<ListResponse<IdLike>>('GET', '/api/me/orders?page_size=20', { headers: userHeaders });
  assert(orderList.items.some((item) => idOf(item, ['order_id', 'id'], 'GET /api/me/orders item') === orderId), 'GET /api/me/orders must include created order');

  const orderDetail = await request<unknown>('GET', `/api/me/orders/${orderId}`, { headers: userHeaders });
  assertNoFullReceiverPhone(orderDetail, 'GET /api/me/orders/:id');

  await request('GET', `/api/me/orders/${orderId}/pickup-code`, { headers: userHeaders });

  const afterSale = await request<IdLike>('POST', `/api/me/orders/${orderId}/after-sales`, {
    headers: userHeaders,
    body: {
      type: 'bad_quality',
      reason: 'Docker API E2E 品质问题',
      description: 'Docker API E2E 售后验证',
      requested_refund_cents: 100
    }
  });
  const afterSaleId = idOf(afterSale, ['after_sale_case_id', 'id'], 'POST /api/me/orders/:id/after-sales');

  const afterSales = await request<IdLike[]>('GET', `/api/me/orders/${orderId}/after-sales`, { headers: userHeaders });
  assert(Array.isArray(afterSales), 'GET /api/me/orders/:id/after-sales must return an array');
  assert(afterSales.some((item) => idOf(item, ['after_sale_case_id', 'id'], 'GET /api/me/orders/:id/after-sales item') === afterSaleId), 'GET /api/me/orders/:id/after-sales must include created after-sale case');

  console.log('Docker API E2E verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
