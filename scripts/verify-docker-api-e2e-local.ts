import { PrismaClient } from '@prisma/client';
import { DOCKER_E2E_ADMIN_ID, ensureDockerE2eFixtures } from './lib/docker-e2e-fixtures.js';
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
const prisma = new PrismaClient();
const adminHeaders = {
  'x-admin-role': 'super_admin',
  'x-admin-user-id': DOCKER_E2E_ADMIN_ID
};

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

function withAdmin<T extends { headers?: Record<string, string> }>(init: T = {} as T): T {
  return { ...init, headers: { ...(init.headers ?? {}), ...adminHeaders } };
}

function withAdminJson<T extends { headers?: Record<string, string> }>(init: T = {} as T): T {
  return { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}), ...adminHeaders } };
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

async function requestText(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; label?: string } = {}): Promise<string> {
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
  record(label, { status: response.status, raw: text.slice(0, 1000) });
  assert(response.ok, `${label} failed with HTTP ${response.status}: ${text}`);
  return text;
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
  await ensureDockerE2eFixtures(prisma);
  const dockerAdmin = await prisma.adminUser.findUnique({ where: { id: DOCKER_E2E_ADMIN_ID } });
  assert(dockerAdmin?.status === 'active' && dockerAdmin.role === 'super_admin', 'Docker E2E admin fixture must be active super_admin');
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
  // L38: delivery fee order amount baseline uses configured rule; idempotent read path.
  const deliveryRules = await request<any>('GET', `/api/delivery/rules?pickup_store_id=${encodeURIComponent(pickupStoreId)}`, { label: 'GET /api/delivery/rules?pickup_store_id=main-pickup-store' });
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
  const expectedProductAmount = deliveryOrder.product_amount_cents ?? deliveryOrder.total_amount_cents;
  assert(typeof expectedProductAmount === 'number' && expectedProductAmount > 0, 'delivery order must include product_amount_cents');
  assert(typeof deliveryOrder.delivery_fee_cents === 'number', 'delivery order must include delivery_fee_cents');
  assert(deliveryOrder.pay_amount_cents === expectedProductAmount + deliveryOrder.delivery_fee_cents, 'delivery pay_amount_cents must include delivery_fee_cents');
  const paidDelivery = await request<any>('POST', '/api/payments/mock', { label: 'POST /api/payments/mock delivery amount', body: { order_id: deliveryOrder.id } });
  assert(paidDelivery.pay_amount_cents === deliveryOrder.pay_amount_cents, 'mock payment amount must equal order pay_amount_cents');
  const deliveryUserHeaders = { 'x-openid': `${openid}-delivery` };
  const deliveryDetail = await request<any>('GET', `/api/me/orders/${deliveryOrder.id}`, { label: 'GET /api/me/orders/:id delivery detail', headers: deliveryUserHeaders });
  assert(deliveryDetail.product_amount_cents === expectedProductAmount && deliveryDetail.delivery_fee_cents === deliveryOrder.delivery_fee_cents && deliveryDetail.pay_amount_cents === deliveryOrder.pay_amount_cents, 'user order detail must expose L38 amount fields');
  assert(deliveryDetail.delivery_time_window_text || deliveryDetail.delivery?.delivery_time_window_text, 'user order detail must expose delivery_time_window_text');
  const adminDelivery = await request<any>('GET', '/api/admin/delivery/orders?page_size=50&pickup_type=delivery', withAdmin({ label: 'GET /api/admin/delivery/orders' }));
  assert(JSON.stringify(adminDelivery).includes('delivery_fee_cents') && JSON.stringify(adminDelivery).includes('pay_amount_cents'), 'Admin delivery list must expose delivery fee and pay amount');
  const financeOverview = await request<any>('GET', '/api/admin/finance/reconciliation/overview', withAdmin({ label: 'GET /api/admin/finance/reconciliation/overview' }));
  assert(typeof financeOverview.total_delivery_fee_cents === 'number', 'finance reconciliation summary must include total_delivery_fee_cents');

  // L39: real non-zero delivery refund split baseline.
  const l39WindowCode = `l39_window_${Date.now()}`;
  await request<any>('POST', '/api/admin/delivery/rule-configs', withAdminJson({
    label: 'POST /api/admin/delivery/rule-configs L39 base fee 500',
    body: {
      pickup_store_id: pickupStoreId,
      enabled: true,
      base_fee_cents: 500,
      free_threshold_cents: null,
      max_distance_km: null,
      service_radius_text: 'Docker API E2E L39 配送范围',
      notice: 'Docker API E2E L39 配送规则',
      available_time_windows: [{ code: l39WindowCode, label: 'L39 验证时段', start_time: '10:00', end_time: '12:00' }]
    }
  }));

  const l39DeliveryOrder = await request<any>('POST', '/api/orders/normal', {
    label: 'POST /api/orders/normal L39 delivery fee 500',
    body: { product_id: productId, user_openid: `${openid}-l39-delivery`, client_request_id: `docker-e2e-l39-delivery-${Date.now()}`, quantity: 1, pickup_type: 'delivery', pickup_store_id: pickupStoreId, community_id: communityId, receiver_name: 'Docker E2E L39 配送', receiver_phone: receiverPhone, receiver_address: 'L39 配送地址', delivery_time_window_code: l39WindowCode }
  });
  const l39ProductAmount = l39DeliveryOrder.product_amount_cents ?? l39DeliveryOrder.total_amount_cents;
  assert(l39DeliveryOrder.delivery_fee_cents === 500, 'L39 delivery order must use base_fee_cents=500');
  assert(l39DeliveryOrder.pay_amount_cents === l39ProductAmount + 500, 'L39 delivery pay_amount_cents must equal product_amount_cents + 500');
  await request<any>('POST', '/api/payments/mock', { label: 'POST /api/payments/mock L39 delivery', body: { order_id: l39DeliveryOrder.id } });

  const l39DeliveryHeaders = { 'x-openid': `${openid}-l39-delivery` };
  const l39AfterSale = await request<IdLike>('POST', `/api/me/orders/${l39DeliveryOrder.id}/after-sales`, {
    label: 'POST /api/me/orders/:id/after-sales L39 split request',
    headers: l39DeliveryHeaders,
    body: { type: 'missing_item', reason: 'Docker API E2E L39 拆分退款', description: 'L39 product/delivery refund split', requested_refund_cents: 300, requested_product_refund_cents: 100, requested_delivery_refund_cents: 200 }
  });
  const l39AfterSaleId = idOf(l39AfterSale, ['after_sale_case_id', 'id'], 'POST /api/me/orders/:id/after-sales L39 split request');
  const missingAdminReview = await request<any>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, {
    label: 'POST /api/admin/after-sales/:id/review L40 missing admin fixture',
    expectedStatus: 400,
    headers: { 'content-type': 'application/json', 'x-admin-role': 'super_admin', 'x-admin-user-id': 'docker-e2e-missing-admin' },
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'missing admin should fail' }
  });
  assert((missingAdminReview as any).message?.includes('管理员不存在或已停用'), 'Missing admin id must return business error before Prisma FK violation');
  const inactiveAdminId = 'docker-e2e-inactive-admin';
  await prisma.adminUser.upsert({
    where: { id: inactiveAdminId },
    update: { role: 'super_admin', status: 'inactive' },
    create: { id: inactiveAdminId, username: 'docker-e2e-inactive-admin-user', password_hash: 'docker-e2e-placeholder-not-for-login', role: 'super_admin', status: 'inactive' }
  });
  const inactiveAdminReview = await request<any>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, {
    label: 'POST /api/admin/after-sales/:id/review L40 inactive admin',
    expectedStatus: 400,
    headers: { 'content-type': 'application/json', 'x-admin-role': 'super_admin', 'x-admin-user-id': inactiveAdminId },
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'inactive admin should fail' }
  });
  assert((inactiveAdminReview as any).message?.includes('管理员不存在或已停用'), 'Inactive admin id must return business error before Prisma FK violation');
  await request<any>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, withAdminJson({
    label: 'POST /api/admin/after-sales/:id/review L39 split approval',
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'Docker API E2E L39 split approval' }
  }));

  // L40: Admin order detail and after-sale workbench must expose split review data without triggering a refund automatically.
  const l40AfterSaleList = await request<any[]>('GET', `/api/admin/after-sales?order_no=${encodeURIComponent(l39DeliveryOrder.order_no ?? '')}`, withAdmin({ label: 'GET /api/admin/after-sales L40 workbench list' }));
  assert(Array.isArray(l40AfterSaleList) && l40AfterSaleList.some((item) => item.after_sale_case_id === l39AfterSaleId), 'L40 admin after-sale list must include reviewed case');
  const l40AfterSaleDetail = await request<any>('GET', `/api/admin/after-sales/${l39AfterSaleId}`, withAdmin({ label: 'GET /api/admin/after-sales/:id L40 detail' }));
  assert(l40AfterSaleDetail.approved_product_refund_cents === 100, 'L40 after-sale detail must include approved_product_refund_cents=100');
  assert(l40AfterSaleDetail.approved_delivery_refund_cents === 200, 'L40 after-sale detail must include approved_delivery_refund_cents=200');
  assert(l40AfterSaleDetail.approved_refund_cents === 300, 'L40 after-sale detail must include approved_refund_cents=300');
  assert(l40AfterSaleDetail.handler?.id === DOCKER_E2E_ADMIN_ID, 'L40 after-sale detail must show docker-e2e-admin reviewer');
  assert(l40AfterSaleDetail.order.receiver_phone_masked && !JSON.stringify(l40AfterSaleDetail).includes(receiverPhone), 'L40 after-sale detail must only include masked receiver_phone');
  const l40OrderDetailBeforeRefund = await request<any>('GET', `/api/admin/orders/${l39DeliveryOrder.id}`, withAdmin({ label: 'GET /api/admin/orders/:id L40 before manual refund' }));
  assert(l40OrderDetailBeforeRefund.after_sale_summary.approved_product_refund_cents >= 100, 'L40 order detail must summarize approved product refund split');
  assert(l40OrderDetailBeforeRefund.after_sale_summary.approved_delivery_refund_cents >= 200, 'L40 order detail must summarize approved delivery refund split');
  assert(l40OrderDetailBeforeRefund.product_refund_amount_cents === 0 && l40OrderDetailBeforeRefund.delivery_refund_amount_cents === 0 && l40OrderDetailBeforeRefund.refund_amount_cents === 0, 'L40 review must not automatically create refund amounts before manual resolve');
  assert(l40OrderDetailBeforeRefund.receiver_phone_masked && !JSON.stringify(l40OrderDetailBeforeRefund).includes(receiverPhone), 'L40 admin order detail must only include masked receiver_phone');
  await request<any>('GET', `/api/admin/orders/${l39DeliveryOrder.id}`, { ...withAdmin({ label: 'GET /api/admin/orders/:id L40 insufficient permission', expectedStatus: 403 }), headers: { 'x-admin-role': 'operator', 'x-admin-user-id': 'docker-e2e-operator' } });
  await request<any>('GET', `/api/admin/orders/${l39DeliveryOrder.id}`, { ...withAdmin({ label: 'GET /api/admin/orders/:id L40 cross pickup scope', expectedStatus: 403 }), headers: { 'x-admin-role': 'store_manager', 'x-admin-user-id': 'docker-e2e-store-manager', 'x-admin-pickup-store-id': 'docker-e2e-other-store' } });
  await request<any>('GET', `/api/admin/after-sales/${l39AfterSaleId}`, { ...withAdmin({ label: 'GET /api/admin/after-sales/:id L40 cross pickup scope', expectedStatus: 403 }), headers: { 'x-admin-role': 'store_manager', 'x-admin-user-id': 'docker-e2e-store-manager', 'x-admin-pickup-store-id': 'docker-e2e-other-store' } });
  await request<any>('POST', `/api/admin/after-sales/${l39AfterSaleId}/resolve`, withAdminJson({
    label: 'POST /api/admin/after-sales/:id/resolve L39 split refund',
    body: { resolution_type: 'partial_refund', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'Docker API E2E L39 split refund' }
  }));
  const l40ResolvedCase = await prisma.afterSaleCase.findUnique({ where: { id: l39AfterSaleId } });
  assert(l40ResolvedCase?.reviewed_by_admin_id === DOCKER_E2E_ADMIN_ID, 'reviewed_by_admin_id must equal docker-e2e-admin');
  assert(l40ResolvedCase?.resolved_by_admin_id === DOCKER_E2E_ADMIN_ID, 'resolved_by_admin_id must equal docker-e2e-admin');

  const l39Detail = await request<any>('GET', `/api/me/orders/${l39DeliveryOrder.id}`, { label: 'GET /api/me/orders/:id L39 split detail', headers: l39DeliveryHeaders });
  assert(l39Detail.product_refund_amount_cents === 100, 'L39 detail must include product_refund_amount_cents=100');
  assert(l39Detail.delivery_refund_amount_cents === 200, 'L39 detail must include delivery_refund_amount_cents=200');
  assert(l39Detail.refund_amount_cents === 300, 'L39 detail must include refund_amount_cents=300');
  assert(l39Detail.remaining_refundable_amount_cents === l39DeliveryOrder.pay_amount_cents - 300, 'L39 detail must include remaining_refundable_amount_cents=pay_amount_cents-300');

  const l39FinanceOverview = await request<any>('GET', '/api/admin/finance/reconciliation/overview', withAdmin({ label: 'GET /api/admin/finance/reconciliation/overview L39 split refund' }));
  assert(l39FinanceOverview.total_product_refund_amount_cents >= 100, 'L39 finance overview must include total_product_refund_amount_cents >= 100');
  assert(l39FinanceOverview.total_delivery_refund_amount_cents >= 200, 'L39 finance overview must include total_delivery_refund_amount_cents >= 200');
  assert(l39FinanceOverview.total_refund_amount_cents >= 300, 'L39 finance overview must include total_refund_amount_cents >= 300');

  const refundCsv = await requestText('GET', '/api/admin/finance/refund-ledger/export.csv', withAdmin({ label: 'GET /api/admin/finance/refund-ledger/export.csv L39 split refund' }));
  assert(refundCsv.includes('product_refund_amount_cents'), 'L39 refund CSV must include product_refund_amount_cents');
  assert(refundCsv.includes('delivery_refund_amount_cents'), 'L39 refund CSV must include delivery_refund_amount_cents');
  assert(refundCsv.includes('refund_amount_cents'), 'L39 refund CSV must include refund_amount_cents');


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

  assert((order as any).delivery_fee_cents === 0, 'store order delivery_fee_cents must be 0');
  assert(((order as any).product_amount_cents ?? (order as any).total_amount_cents) === (order as any).pay_amount_cents, 'store pay_amount_cents must equal product_amount_cents');

  await request('POST', '/api/payments/mock', { label: 'POST /api/payments/mock', body: { order_id: orderId } });

  await request<any>('POST', `/api/me/orders/${orderId}/after-sales`, {
    label: 'POST /api/me/orders/:id/after-sales store delivery refund must fail',
    headers: { 'x-openid': openid },
    expectedStatus: 400,
    body: { type: 'wrong_item', reason: 'Docker API E2E 门店自提配送费退款应失败', requested_refund_cents: 300, requested_product_refund_cents: 100, requested_delivery_refund_cents: 200 }
  });

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
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
