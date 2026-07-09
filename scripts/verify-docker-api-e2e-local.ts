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
  group_buy_id?: string;
  order_id?: string;
  after_sale_case_id?: string;
};

type AuditCase = {
  label: string;
  payload: unknown;
};

const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://127.0.0.1:13080').replace(/\/$/, '');
const debug = process.argv.includes('--debug');
const auditCases: AuditCase[] = [];

const forbiddenKeys = [
  'cost_price_cents',
  'commission_value',
  'commission_type',
  'stock_deduct_quantity',
  'receiver_phone',
  'password_hash',
  'totp_secret',
  'private_key',
  'id_card_no',
  'bank_account_no'
];

const receiverPhone = '13812345678';
const groupReceiverPhone = '13912345678';
const forbiddenValues = [receiverPhone, groupReceiverPhone];
const openid = `docker-e2e-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(label: string, payload: unknown) {
  auditCases.push({ label, payload });
  if (debug) {
    console.log(`\n--- ${label} ---`);
    console.log(JSON.stringify(payload, null, 2));
  }
}

function collectRiskFindings(label: string, value: unknown) {
  const findings: string[] = [];
  const seen = new WeakSet<object>();

  function walk(current: unknown, path: string) {
    if (typeof current === 'string') {
      for (const forbiddenValue of forbiddenValues) {
        if (current.includes(forbiddenValue)) findings.push(`${path} contains forbidden value ${forbiddenValue}`);
      }
      return;
    }
    if (current === null || typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbiddenKeys.includes(key)) findings.push(`${childPath} contains forbidden key ${key}`);
      walk(child, childPath);
    }
  }

  walk(value, '$');
  return findings.map((finding) => `${label}: ${finding}`);
}

async function request<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; label?: string; expectedStatus?: number } = {}): Promise<T> {
  const label = options.label ?? `${method} ${path}`;
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
    record(label, { status: response.status, raw: text });
    throw new Error(`${label} returned non-JSON response (${response.status}): ${text}`);
  }
  record(label, parsed);
  if (options.expectedStatus) {
    assert(response.status === options.expectedStatus, `${label} expected HTTP ${options.expectedStatus} but got ${response.status}: ${parsed.message}`);
    return parsed as unknown as T;
  }
  assert(response.ok, `${label} failed with HTTP ${response.status}: ${parsed.message}`);
  assert(parsed.success === true, `${label} must return success=true: ${parsed.message}`);
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

function assertNoRiskFindings() {
  const findings = auditCases.flatMap(({ label, payload }) => collectRiskFindings(label, payload));
  if (findings.length > 0) {
    console.error('Docker API E2E risk findings:');
    for (const finding of findings) console.error(`- ${finding}`);
    throw new Error(`Docker API E2E found ${findings.length} risk findings`);
  }
}

async function main() {
  await request('GET', '/api/health');

  const products = await request<ListResponse<IdLike>>('GET', '/api/products?page_size=1&only_in_stock=true', { label: 'GET /api/products' });
  const productId = idOf(firstItem(products, 'GET /api/products'), ['product_id', 'id'], 'GET /api/products');

  await request('GET', `/api/products/${productId}`, { label: 'GET /api/products/:id' });
  const productGroupBuys = await request<ListResponse<IdLike>>('GET', `/api/products/${productId}/group-buys?page_size=1`, { label: 'GET /api/products/:id/group-buys' });

  const communities = await request<ListResponse<IdLike>>('GET', '/api/communities?page_size=1', { label: 'GET /api/communities' });
  const communityId = idOf(firstItem(communities, 'GET /api/communities'), ['community_id', 'id'], 'GET /api/communities');

  const pickupStores = await request<ListResponse<IdLike>>('GET', '/api/pickup-stores?page_size=1', { label: 'GET /api/pickup-stores' });
  const pickupStoreId = idOf(firstItem(pickupStores, 'GET /api/pickup-stores'), ['pickup_store_id', 'id'], 'GET /api/pickup-stores');
  await request('GET', `/api/pickup-stores/${pickupStoreId}`, { label: 'GET /api/pickup-stores/:id' });
  const deliveryRules = await request<any>('GET', '/api/delivery/rules', { label: 'GET /api/delivery/rules' });
  assert(Array.isArray(deliveryRules.available_time_windows) && deliveryRules.available_time_windows.length > 0, 'GET /api/delivery/rules must include available_time_windows');
  const deliveryWindowCode = deliveryRules.available_time_windows[0].code;
  const missingWindow = await request<any>('POST', '/api/orders/normal', {
    label: 'POST /api/orders/normal delivery missing delivery_time_window_code',
    expectedStatus: 400,
    body: { product_id: productId, user_openid: `${openid}-missing-window`, client_request_id: `docker-e2e-delivery-missing-window-${Date.now()}`, quantity: 1, pickup_type: 'delivery', pickup_store_id: pickupStoreId, community_id: communityId, receiver_name: 'Docker E2E 配送', receiver_phone: receiverPhone, receiver_address: '测试配送地址' }
  });
  assert(missingWindow === null || missingWindow.success === false || missingWindow.message, 'missing delivery_time_window_code should fail');
  const deliveryOrder = await request<any>('POST', '/api/orders/normal', {
    label: 'POST /api/orders/normal delivery with delivery_time_window_code',
    body: { product_id: productId, user_openid: `${openid}-delivery`, client_request_id: `docker-e2e-delivery-${Date.now()}`, quantity: 1, pickup_type: 'delivery', pickup_store_id: pickupStoreId, community_id: communityId, receiver_name: 'Docker E2E 配送', receiver_phone: receiverPhone, receiver_address: '测试配送地址', delivery_time_window_code: deliveryWindowCode }
  });
  assert(deliveryOrder.pickup_type === 'delivery', 'delivery order response must include pickup_type=delivery');
  assert(deliveryOrder.receiver_phone_masked && !JSON.stringify(deliveryOrder).includes(receiverPhone), 'delivery order response must include receiver_phone_masked and hide raw phone');


  const order = await request<IdLike>('POST', '/api/orders/normal', {
    label: 'POST /api/orders/normal',
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
  const orderId = idOf(order, ['order_id', 'id'], 'POST /api/orders/normal');

  await request('POST', '/api/payments/mock', { label: 'POST /api/payments/mock', body: { order_id: orderId } });

  const userHeaders = { 'x-openid': openid };
  const orderList = await request<ListResponse<IdLike>>('GET', '/api/me/orders?page_size=20', { label: 'GET /api/me/orders', headers: userHeaders });
  assert(orderList.items.some((item) => idOf(item, ['order_id', 'id'], 'GET /api/me/orders item') === orderId), 'GET /api/me/orders must include created order');

  await request('GET', `/api/me/orders/${orderId}`, { label: 'GET /api/me/orders/:id', headers: userHeaders });
  await request('GET', `/api/me/orders/${orderId}/pickup-code`, { label: 'GET /api/me/orders/:id/pickup-code', headers: userHeaders });

  const afterSale = await request<IdLike>('POST', `/api/me/orders/${orderId}/after-sales`, {
    label: 'POST /api/me/orders/:id/after-sales',
    headers: userHeaders,
    body: {
      type: 'bad_quality',
      reason: 'Docker API E2E 品质问题',
      description: 'Docker API E2E 售后验证',
      requested_refund_cents: 100
    }
  });
  const afterSaleId = idOf(afterSale, ['after_sale_case_id', 'id'], 'POST /api/me/orders/:id/after-sales');

  const afterSales = await request<IdLike[]>('GET', `/api/me/orders/${orderId}/after-sales`, { label: 'GET /api/me/orders/:id/after-sales', headers: userHeaders });
  assert(Array.isArray(afterSales), 'GET /api/me/orders/:id/after-sales must return an array');
  assert(afterSales.some((item) => idOf(item, ['after_sale_case_id', 'id'], 'GET /api/me/orders/:id/after-sales item') === afterSaleId), 'GET /api/me/orders/:id/after-sales must include created after-sale case');

  const groupBuy = productGroupBuys.items?.[0];
  if (groupBuy) {
    const groupBuyId = idOf(groupBuy, ['group_buy_id', 'id'], 'GET /api/products/:id/group-buys item');
    const groupOrder = await request<IdLike>('POST', '/api/orders', {
      label: 'POST /api/orders',
      body: {
        group_buy_id: groupBuyId,
        user_openid: openid,
        client_request_id: `docker-e2e-group-${Date.now()}`,
        quantity: 1,
        pickup_store_id: pickupStoreId,
        community_id: communityId,
        receiver_name: 'Docker E2E 团购用户',
        receiver_phone: groupReceiverPhone
      }
    });
    const groupOrderId = idOf(groupOrder, ['order_id', 'id'], 'POST /api/orders');
    await request('POST', '/api/payments/mock', { label: 'POST /api/payments/mock for group order', body: { order_id: groupOrderId } });
    await request('GET', `/api/me/orders/${groupOrderId}`, { label: 'GET /api/me/orders/:groupOrderId', headers: userHeaders });
  }

  assertNoRiskFindings();
  console.log('Docker API E2E verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
