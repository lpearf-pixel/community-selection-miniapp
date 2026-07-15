import { PrismaClient } from '@prisma/client';
import { L45_API_CONTRACT } from './l45-api-contract.js';
import { ensureTaxExportWithinLimit } from '../apps/api/src/routes/withdrawals.js';
import { ensureEstimatedCommission, getAvailableRewardBalance, markCommissionPendingForCompletedOrder, releaseDueCommissions, syncCommissionAfterRefund } from '../apps/api/src/services/commission-service.js';
import { DOCKER_E2E_ADMIN_ID, DOCKER_E2E_FINANCE_ADMIN_ID, DOCKER_E2E_INACTIVE_ADMIN_ID, DOCKER_E2E_OPERATOR_ADMIN_ID, DOCKER_E2E_STORE_MANAGER_ADMIN_ID, DOCKER_E2E_COMMUNITY_ID, DOCKER_E2E_INITIAL_STOCK, DOCKER_E2E_INSUFFICIENT_STOCK_PRODUCT_ID, DOCKER_E2E_PICKUP_STORE_ID, DOCKER_E2E_PRODUCT_ID, ensureDockerE2eFixtures } from './lib/docker-e2e-fixtures.js';
type ApiResponse<T> = {
  success: boolean;
  data: T;
  message: string;
};

type ErrorApiResponse = {
  success: false;
  data: null;
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

type L43GlobalOperationResult = {
  matched_count: number;
  released_count?: number;
  already_released_count?: number;
  ledger_created_count: number;
};

type L43CommissionFixture = {
  prefix: string;
  leaderId: string;
  commissionId: string;
  orderId: string;
  amountCents: number;
};

const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://localhost:13080').replace(/\/$/, '');
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

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) return `${error.name}: ${error.message}`;
  if (cause instanceof Error) return `${error.name}: ${error.message}; cause=${cause.name}: ${cause.message}`;
  if (typeof cause === 'object' && cause !== null) {
    const fields = cause as Record<string, unknown>;
    return `${error.name}: ${error.message}; cause=${JSON.stringify({ code: fields.code, errno: fields.errno, syscall: fields.syscall, address: fields.address, port: fields.port })}`;
  }
  return `${error.name}: ${error.message}; cause=${String(cause)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOrThrow(method: string, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;
  try {
    return await fetchWithTimeout(url, { ...init, method }, timeoutMs);
  } catch (error) {
    throw new Error(`${method} ${url} transport failed: ${errorDetails(error)}. Check docker compose ps and docker compose logs --tail=200 api.`);
  }
}

async function waitForApiReady(maxAttempts = 90, intervalMs = 1_000): Promise<void> {
  const path = '/api/health';
  let lastFailure = 'not attempted';
  console.log(`Docker API E2E target: ${API_BASE_URL}`);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchOrThrow('GET', path, {}, 2_000);
      const body = await response.text();
      if (response.ok) {
        console.log(`Docker API ready after ${attempt} attempt(s).`);
        return;
      }
      lastFailure = `HTTP ${response.status}: ${body.slice(0, 300)}`;
    } catch (error) {
      lastFailure = errorDetails(error);
    }
    if (attempt === 1 || attempt % 10 === 0) {
      console.log(`Waiting for Docker API (${attempt}/${maxAttempts}): ${lastFailure}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Docker API did not become ready at ${API_BASE_URL}${path} after ${maxAttempts} attempts. Last failure: ${lastFailure}. Run docker compose ps and docker compose logs --tail=200 api.`);
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
  const response = await fetchOrThrow(method, path, {
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
  const response = await fetchOrThrow(method, path, {
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

function assertSafeL42Response(payload: unknown, label: string) {
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['"receiver_phone"', '"receiver_address"', '"cost_price_cents"', '"raw_notify"', '"password_hash"', '"commission_value"', '"commission_type"', '"stock_deduct_quantity"']) {
    assert(!serialized.includes(forbidden), `${label} must not expose ${forbidden}`);
  }
}

async function getProductInventory(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { stock: true, stock_deduct_quantity: true } });
  assert(product, `Docker API E2E product fixture missing: ${productId}`);
  return product;
}

async function logInventoryFailure(input: { product_id: string; order_quantity: number; client_request_id: string }) {
  const product = await getProductInventory(input.product_id);
  console.error('Docker API E2E inventory failure:');
  console.error(`product_id=${input.product_id}`);
  console.error(`current_stock=${product.stock}`);
  console.error(`order_quantity=${input.order_quantity}`);
  console.error(`stock_deduct_quantity=${product.stock_deduct_quantity}`);
  console.error(`required_stock=${input.order_quantity * product.stock_deduct_quantity}`);
  console.error(`client_request_id=${input.client_request_id}`);
}

async function requestOrderWithInventoryContext<T>(body: Record<string, unknown>, label: string): Promise<T> {
  try {
    return await request<T>('POST', '/api/orders/normal', { label, body });
  } catch (error) {
    if (String(error).includes('库存不足')) {
      await logInventoryFailure({
        product_id: String(body.product_id ?? ''),
        order_quantity: Number(body.quantity ?? 0),
        client_request_id: String(body.client_request_id ?? '')
      });
    }
    throw error;
  }
}


async function cleanupL43RewardFixtures(prefix: string) {
  await prisma.rewardLedger.deleteMany({ where: { OR: [{ idempotency_key: { startsWith: prefix } }, { order_id: { startsWith: prefix } }, { commission_id: { startsWith: prefix } }] } });
  await prisma.commission.deleteMany({ where: { OR: [{ id: { startsWith: prefix } }, { order_id: { startsWith: prefix } }, { group_buy_id: { startsWith: prefix } }] } });
  await prisma.refund.deleteMany({ where: { OR: [{ id: { startsWith: prefix } }, { order_id: { startsWith: prefix } }, { client_refund_id: { startsWith: prefix } }] } });
  await prisma.order.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.groupBuy.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.product.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.category.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.community.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.adminUser.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function cleanupL43GlobalOperationFixtures() {
  for (const prefix of ['l43-release-due-e2e-', 'l43-settle-e2e-', 'l43-backfill-e2e-']) {
    await cleanupL43RewardFixtures(prefix);
  }
}

async function createL43CommissionFixture(prefix: string, status: 'pending' | 'available', amountCents: number): Promise<L43CommissionFixture> {
  const now = new Date('2026-07-13T00:00:00.000Z');
  const availableAt = new Date(Date.now() - 60_000);
  const leader = await prisma.user.create({ data: { id: `${prefix}leader`, openid: `${prefix}leader-openid`, nickname: `${prefix}Leader`, role: 'leader' } });
  const buyer = await prisma.user.create({ data: { id: `${prefix}buyer`, openid: `${prefix}buyer-openid`, nickname: `${prefix}Buyer`, role: 'customer' } });
  const category = await prisma.category.create({ data: { id: `${prefix}category`, name: `${prefix}category`, sort_order: 1 } });
  const product = await prisma.product.create({ data: { id: `${prefix}product`, name: `${prefix}product`, category_id: category.id, price_cents: amountCents * 10, cost_price_cents: 1, stock: 100, unit: '份', stock_unit: 'piece', sale_unit: '份', is_group_enabled: true, commission_type: 'percent', commission_value: 10, status: 'active' } });
  const community = await prisma.community.create({ data: { id: `${prefix}community`, name: `${prefix}community`, address: `${prefix}address` } });
  const groupBuy = await prisma.groupBuy.create({ data: { id: `${prefix}group`, product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, current_people: 1, current_quantity: 1, price_cents: amountCents * 10, start_time: now, end_time: new Date(now.getTime() + 86_400_000), pickup_time: new Date(now.getTime() + 172_800_000), status: 'success' } });
  const order = await prisma.order.create({ data: { id: `${prefix}order`, order_no: `${prefix}order-no`, user_id: buyer.id, group_buy_id: groupBuy.id, product_id: product.id, leader_user_id: leader.id, total_amount_cents: amountCents * 10, product_amount_cents: amountCents * 10, delivery_fee_cents: 0, pay_amount_cents: amountCents * 10, quantity: 1, pay_status: 'paid', order_status: 'completed', refund_status: 'none', pickup_type: 'store', community_id: community.id, receiver_name: `${prefix}Buyer`, receiver_phone: '13600000000', paid_at: now, completed_at: now } });
  const commission = await prisma.commission.create({ data: { id: `${prefix}commission`, leader_user_id: leader.id, order_id: order.id, group_buy_id: groupBuy.id, base_amount_cents: amountCents * 10, commission_type: 'percent', commission_value: 10, estimated_amount_cents: amountCents, final_amount_cents: amountCents, deduct_amount_cents: 0, status, available_at: availableAt } });
  return { prefix, leaderId: leader.id, commissionId: commission.id, orderId: order.id, amountCents };
}

async function createL43PendingCommissionFixture(prefix: string, amountCents: number) {
  return createL43CommissionFixture(prefix, 'pending', amountCents);
}

async function createL43AvailableWithoutLedgerFixture(prefix: string, amountCents: number) {
  return createL43CommissionFixture(prefix, 'available', amountCents);
}

async function assertGlobalOperationRelease(path: '/api/admin/rewards/release-due' | '/api/admin/commissions/settle', fixture: L43CommissionFixture, superAdminHeaders: Record<string, string>, label: string) {
  const beforeBalance = await getAvailableRewardBalance(prisma, fixture.leaderId);
  const releaseResult = await request<L43GlobalOperationResult>('POST', path, { headers: superAdminHeaders, label: `${label} first success` });
  console.log(`${label} response:`);
  console.log(JSON.stringify(releaseResult, null, 2));
  assert(releaseResult.matched_count >= 1, `${label} matched_count must be >= 1; actual=${releaseResult.matched_count}; fixture=${fixture.commissionId}`);
  assert((releaseResult.released_count ?? 0) >= 1, `${label} released_count must be >= 1; actual=${releaseResult.released_count}; fixture=${fixture.commissionId}`);
  assert(releaseResult.ledger_created_count >= 1, `${label} ledger_created_count must be >= 1; actual=${releaseResult.ledger_created_count}; fixture=${fixture.commissionId}`);
  const releasedCommission = await prisma.commission.findUniqueOrThrow({ where: { id: fixture.commissionId } });
  const availableLedgers = await prisma.rewardLedger.findMany({ where: { commission_id: fixture.commissionId, event_type: 'commission_available' } });
  const afterBalance = await getAvailableRewardBalance(prisma, fixture.leaderId);
  if (releasedCommission.status !== 'available' || availableLedgers.length !== 1 || afterBalance !== beforeBalance + fixture.amountCents) {
    console.log(`${label} fixture commission:`);
    console.log(JSON.stringify(await prisma.commission.findUnique({ where: { id: fixture.commissionId } }), null, 2));
  }
  assert(releasedCommission.status === 'available', `${label} fixture commission must become available`);
  assert(availableLedgers.length === 1, `${label} fixture must have exactly one available ledger`);
  assert(availableLedgers[0].amount_cents === fixture.amountCents, `${label} fixture ledger amount mismatch`);
  assert(availableLedgers[0].affects_available_balance === true, `${label} fixture ledger must affect available balance`);
  assert(afterBalance === beforeBalance + fixture.amountCents, `${label} fixture balance must increase once`);

  const fixtureLedgerCountBeforeRepeat = await prisma.rewardLedger.count({ where: { commission_id: fixture.commissionId, event_type: 'commission_available' } });
  const balanceBeforeRepeat = await getAvailableRewardBalance(prisma, fixture.leaderId);
  const releaseRepeat = await request<L43GlobalOperationResult>('POST', path, { headers: superAdminHeaders, label: `${label} repeat success` });
  console.log(`${label} repeat response:`);
  console.log(JSON.stringify(releaseRepeat, null, 2));
  const fixtureLedgerCountAfterRepeat = await prisma.rewardLedger.count({ where: { commission_id: fixture.commissionId, event_type: 'commission_available' } });
  const balanceAfterRepeat = await getAvailableRewardBalance(prisma, fixture.leaderId);
  assert((await prisma.commission.findUniqueOrThrow({ where: { id: fixture.commissionId } })).status === 'available', `${label} repeat must keep commission available`);
  assert(fixtureLedgerCountAfterRepeat === fixtureLedgerCountBeforeRepeat, `${label} repeat must not duplicate fixture ledger`);
  assert(balanceAfterRepeat === balanceBeforeRepeat, `${label} repeat must not increase fixture balance`);
  return { first: releaseResult, repeat: releaseRepeat, balanceAfter: afterBalance, fixtureStatus: releasedCommission.status, fixtureLedgerCount: availableLedgers.length, fixtureBalanceVerified: afterBalance === beforeBalance + fixture.amountCents, repeatFixtureLedgerCount: fixtureLedgerCountAfterRepeat, repeatBalanceAfter: balanceAfterRepeat };
}

async function assertGlobalOperationBackfill(fixture: L43CommissionFixture, superAdminHeaders: Record<string, string>) {
  const beforeBalance = await getAvailableRewardBalance(prisma, fixture.leaderId);
  const backfillResult = await request<L43GlobalOperationResult>('POST', '/api/admin/rewards/backfill', { headers: superAdminHeaders, label: 'L43 super_admin backfill first success' });
  console.log('backfillResult response:');
  console.log(JSON.stringify(backfillResult, null, 2));
  assert(backfillResult.matched_count >= 1, `backfillResult matched_count must be >= 1; actual=${backfillResult.matched_count}; fixture=${fixture.commissionId}`);
  assert(backfillResult.ledger_created_count >= 1, `backfillResult ledger_created_count must be >= 1; actual=${backfillResult.ledger_created_count}; fixture=${fixture.commissionId}`);
  const backfillLedgers = await prisma.rewardLedger.findMany({ where: { commission_id: fixture.commissionId, event_type: 'commission_available_backfill' } });
  const afterBalance = await getAvailableRewardBalance(prisma, fixture.leaderId);
  if (backfillLedgers.length !== 1 || afterBalance !== beforeBalance + fixture.amountCents) {
    console.log('backfill fixture commission:');
    console.log(JSON.stringify(await prisma.commission.findUnique({ where: { id: fixture.commissionId } }), null, 2));
  }
  assert(backfillLedgers.length === 1, 'backfill fixture must create exactly one backfill ledger');
  assert(backfillLedgers[0].amount_cents === fixture.amountCents && backfillLedgers[0].affects_available_balance === true, 'backfill ledger amount and balance flag must match commission');
  assert(backfillLedgers[0].commission_id === fixture.commissionId && backfillLedgers[0].leader_user_id === fixture.leaderId, 'backfill ledger must reference the fixture commission and leader');
  assert(typeof backfillLedgers[0].idempotency_key === 'string' && backfillLedgers[0].idempotency_key.length > 0, 'backfill ledger idempotency_key must be non-empty');
  assert(afterBalance === beforeBalance + fixture.amountCents, 'backfill must increase available balance once');

  const fixtureLedgerCountBeforeRepeat = await prisma.rewardLedger.count({ where: { commission_id: fixture.commissionId, event_type: 'commission_available_backfill' } });
  const balanceBeforeRepeat = await getAvailableRewardBalance(prisma, fixture.leaderId);
  const idempotencyKeyBeforeRepeat = backfillLedgers[0].idempotency_key;
  const backfillRepeat = await request<L43GlobalOperationResult>('POST', '/api/admin/rewards/backfill', { headers: superAdminHeaders, label: 'L43 super_admin backfill repeat success' });
  console.log('backfillRepeat response:');
  console.log(JSON.stringify(backfillRepeat, null, 2));
  const backfillLedgersAfterRepeat = await prisma.rewardLedger.findMany({ where: { commission_id: fixture.commissionId, event_type: 'commission_available_backfill' } });
  const balanceAfterRepeat = await getAvailableRewardBalance(prisma, fixture.leaderId);
  assert(backfillLedgersAfterRepeat.length === fixtureLedgerCountBeforeRepeat, 'backfill repeat must not create duplicate fixture ledger');
  assert(balanceAfterRepeat === balanceBeforeRepeat, 'backfill repeat must not increase fixture balance');
  assert(backfillLedgersAfterRepeat[0].idempotency_key === idempotencyKeyBeforeRepeat, 'backfill repeat must keep fixture idempotency key unchanged');
  return { first: backfillResult, repeat: backfillRepeat, balanceAfter: afterBalance, fixtureLedgerCount: backfillLedgers.length, fixtureBalanceVerified: afterBalance === beforeBalance + fixture.amountCents, repeatFixtureLedgerCount: backfillLedgersAfterRepeat.length, repeatBalanceAfter: balanceAfterRepeat };
}

async function runL43RewardLedgerScenario() {
  const prefix = `l43-e2e-${Date.now()}`;
  await cleanupL43RewardFixtures('l43-e2e-');
  await cleanupL43GlobalOperationFixtures();
  const now = new Date('2026-07-13T00:00:00.000Z');
  const leader = await prisma.user.create({ data: { id: `${prefix}-leader`, openid: `${prefix}-leader-openid`, nickname: 'L43 Leader', role: 'leader' } });
  const buyer = await prisma.user.create({ data: { id: `${prefix}-buyer`, openid: `${prefix}-buyer-openid`, nickname: 'L43 Buyer', role: 'customer' } });
  const category = await prisma.category.create({ data: { id: `${prefix}-category`, name: `${prefix}-category`, sort_order: 1 } });
  const product = await prisma.product.create({ data: { id: `${prefix}-product`, name: `${prefix}-product`, category_id: category.id, price_cents: 10000, cost_price_cents: 1000, stock: 100, unit: '份', stock_unit: 'piece', sale_unit: '份', is_group_enabled: true, commission_type: 'percent', commission_value: 10, status: 'active' } });
  const community = await prisma.community.create({ data: { id: `${prefix}-community`, name: `${prefix}-community`, address: 'L43 community' } });
  const groupBuy = await prisma.groupBuy.create({ data: { id: `${prefix}-group`, product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, current_people: 1, current_quantity: 1, price_cents: 10000, start_time: now, end_time: new Date(now.getTime() + 86400000), pickup_time: new Date(now.getTime() + 172800000), status: 'success' } });
  const order = await prisma.order.create({ data: { id: `${prefix}-order`, order_no: `${prefix}-order-no`, user_id: buyer.id, group_buy_id: groupBuy.id, product_id: product.id, leader_user_id: leader.id, total_amount_cents: 10000, product_amount_cents: 10000, delivery_fee_cents: 500, pay_amount_cents: 10500, quantity: 1, pay_status: 'paid', order_status: 'paid', refund_status: 'none', pickup_type: 'delivery', community_id: community.id, receiver_name: 'L43 Buyer', receiver_phone: '13600000000', receiver_address: 'L43 address', paid_at: now } });

  const estimated = await ensureEstimatedCommission(order.id);
  assert(estimated?.status === 'estimated', 'L43 commission must be estimated after paid group-buy order');
  assert(estimated.estimated_amount_cents === 1000 && estimated.final_amount_cents === 1000, 'L43 initial reward must be 1000 and exclude delivery fee');

  const completedAt = new Date('2026-07-14T00:00:00.000Z');
  await prisma.order.update({ where: { id: order.id }, data: { order_status: 'completed', completed_at: completedAt } });
  const pending = await markCommissionPendingForCompletedOrder(order.id);
  const expectedAvailableAt = new Date(completedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
  assert(pending?.status === 'pending', 'L43 commission must become pending after completed order');
  assert(pending.available_at?.getTime() === expectedAvailableAt.getTime(), 'L43 available_at must equal completed_at plus 72 hours');

  await releaseDueCommissions({ now: new Date(expectedAvailableAt.getTime() - 1000) });
  let commission = await prisma.commission.findUniqueOrThrow({ where: { id: estimated.id } });
  assert(commission.status === 'pending', 'L43 release before T+3 must keep commission pending');
  assert(await prisma.rewardLedger.count({ where: { commission_id: estimated.id, event_type: 'commission_available' } }) === 0, 'L43 release before T+3 must not create available ledger');
  assert(await getAvailableRewardBalance(prisma, leader.id) === 0, 'L43 available balance before T+3 must be zero');

  await releaseDueCommissions({ now: expectedAvailableAt });
  commission = await prisma.commission.findUniqueOrThrow({ where: { id: estimated.id } });
  assert(commission.status === 'available', 'L43 release at T+3 must make commission available');
  let availableLedgers = await prisma.rewardLedger.findMany({ where: { commission_id: estimated.id, event_type: 'commission_available' } });
  assert(availableLedgers.length === 1 && availableLedgers[0].amount_cents === 1000 && availableLedgers[0].affects_available_balance === true, 'L43 available release must create exactly one 1000-cent available ledger');
  const availableBalanceAfterRelease = await getAvailableRewardBalance(prisma, leader.id);
  assert(availableBalanceAfterRelease === 1000, 'L43 available balance after release must be 1000');
  await Promise.all([releaseDueCommissions({ now: expectedAvailableAt }), releaseDueCommissions({ now: expectedAvailableAt })]);
  availableLedgers = await prisma.rewardLedger.findMany({ where: { commission_id: estimated.id, event_type: 'commission_available' } });
  assert(availableLedgers.length === 1 && await getAvailableRewardBalance(prisma, leader.id) === 1000, 'L43 repeated/concurrent release must not duplicate available ledger');

  await prisma.order.update({ where: { id: order.id }, data: { delivery_refund_amount_cents: 500, refund_amount_cents: 500 } });
  await syncCommissionAfterRefund({ order_id: order.id, refund_id: `${prefix}-delivery-refund` });
  commission = await prisma.commission.findUniqueOrThrow({ where: { id: estimated.id } });
  assert(commission.final_amount_cents === 1000, 'L43 delivery-fee-only refund must not change reward');
  assert(await prisma.rewardLedger.count({ where: { commission_id: estimated.id, event_type: 'commission_refund_deduct' } }) === 0, 'L43 delivery-fee-only refund must not create deduct ledger');
  const availableBalanceAfterDeliveryRefund = await getAvailableRewardBalance(prisma, leader.id);
  assert(availableBalanceAfterDeliveryRefund === 1000, 'L43 delivery-fee-only refund must keep available balance 1000');

  await prisma.order.update({ where: { id: order.id }, data: { product_refund_amount_cents: 3000, delivery_refund_amount_cents: 500, refund_amount_cents: 3500 } });
  await syncCommissionAfterRefund({ order_id: order.id, refund_id: `${prefix}-product-refund-3000` });
  commission = await prisma.commission.findUniqueOrThrow({ where: { id: estimated.id } });
  let deductLedgers = await prisma.rewardLedger.findMany({ where: { commission_id: estimated.id, event_type: 'commission_refund_deduct' } });
  assert(commission.final_amount_cents === 700 && commission.deduct_amount_cents === 300, 'L43 product partial refund must recalculate final reward to 700 and deduct 300');
  assert(deductLedgers.length === 1 && deductLedgers[0].amount_cents === 300, 'L43 product partial refund must create one 300-cent deduct ledger');
  const availableBalanceAfterPartialProductRefund = await getAvailableRewardBalance(prisma, leader.id);
  assert(availableBalanceAfterPartialProductRefund === 700, 'L43 balance after partial product refund must be 700');
  await syncCommissionAfterRefund({ order_id: order.id, refund_id: `${prefix}-product-refund-3000-repeat` });
  deductLedgers = await prisma.rewardLedger.findMany({ where: { commission_id: estimated.id, event_type: 'commission_refund_deduct' } });
  assert(deductLedgers.length === 1 && await getAvailableRewardBalance(prisma, leader.id) === 700, 'L43 repeated partial refund sync must not duplicate deduct ledger');

  await prisma.order.update({ where: { id: order.id }, data: { product_refund_amount_cents: 10000, delivery_refund_amount_cents: 500, refund_amount_cents: 10500 } });
  await syncCommissionAfterRefund({ order_id: order.id, refund_id: `${prefix}-product-refund-full` });
  commission = await prisma.commission.findUniqueOrThrow({ where: { id: estimated.id } });
  deductLedgers = await prisma.rewardLedger.findMany({ where: { commission_id: estimated.id, event_type: 'commission_refund_deduct' } });
  assert(commission.status === 'cancelled' && commission.final_amount_cents === 0, 'L43 full product refund must cancel and zero commission');
  assert(deductLedgers.reduce((sum, item) => sum + item.amount_cents, 0) === 1000, 'L43 full product refund must deduct remaining reward');
  const availableBalanceAfterFullProductRefund = await getAvailableRewardBalance(prisma, leader.id);
  assert(availableBalanceAfterFullProductRefund === 0, 'L43 full product refund must zero available balance');
  await syncCommissionAfterRefund({ order_id: order.id, refund_id: `${prefix}-product-refund-full-repeat` });
  assert(await prisma.rewardLedger.count({ where: { commission_id: estimated.id, event_type: 'commission_refund_deduct' } }) === deductLedgers.length, 'L43 repeated full refund must not duplicate deduct ledger');

  const scopedFinance = await prisma.adminUser.create({ data: { id: `${prefix}-finance`, username: `${prefix}-finance`, password_hash: 'x', role: 'finance', status: 'active' } });
  const storeManager = await prisma.adminUser.create({ data: { id: `${prefix}-store-manager`, username: `${prefix}-store-manager`, password_hash: 'x', role: 'store_manager', status: 'active' } });
  const operator = await prisma.adminUser.create({ data: { id: `${prefix}-operator`, username: `${prefix}-operator`, password_hash: 'x', role: 'operator', status: 'active' } });
  const inactive = await prisma.adminUser.create({ data: { id: `${prefix}-inactive`, username: `${prefix}-inactive`, password_hash: 'x', role: 'super_admin', status: 'inactive' } });
  const superAdmin = await prisma.adminUser.create({ data: { id: `${prefix}-super-admin`, username: `${prefix}-super-admin`, password_hash: 'x', role: 'super_admin', status: 'active' } });
  const successEvents = ['commission_available', 'commission_available_backfill'];
  async function snapshot() {
    return { status: (await prisma.commission.findUniqueOrThrow({ where: { id: estimated.id } })).status, ledgerCount: await prisma.rewardLedger.count(), auditCount: await prisma.adminAuditLog.count(), successEventCount: await prisma.businessEventLog.count({ where: { event_type: { in: successEvents } } }) };
  }
  async function assertNegativeGlobalCall(path: string, headers: Record<string, string>, expectedStatus: number, label: string) {
    const before = await snapshot();
    await request('POST', path, { headers, expectedStatus, label });
    const after = await snapshot();
    assert(JSON.stringify(after) === JSON.stringify(before), `${label} must not mutate commission, ledger, admin audit, or success events`);
  }
  const scopedFinanceHeaders = { 'x-admin-role': 'finance', 'x-admin-user-id': scopedFinance.id, 'x-admin-community-id': community.id };
  const storeHeaders = { 'x-admin-role': 'store_manager', 'x-admin-user-id': storeManager.id, 'x-admin-community-id': community.id };
  const operatorHeaders = { 'x-admin-role': 'operator', 'x-admin-user-id': operator.id };
  const inactiveHeaders = { 'x-admin-role': 'super_admin', 'x-admin-user-id': inactive.id };
  for (const path of ['/api/admin/rewards/release-due', '/api/admin/commissions/settle', '/api/admin/rewards/backfill']) {
    await assertNegativeGlobalCall(path, scopedFinanceHeaders, 403, `scoped finance ${path}`);
    await assertNegativeGlobalCall(path, storeHeaders, 403, `store manager ${path}`);
    await assertNegativeGlobalCall(path, operatorHeaders, 403, `operator ${path}`);
    await assertNegativeGlobalCall(path, inactiveHeaders, 401, `inactive admin ${path}`);
  }
  const superAdminHeaders = { 'x-admin-role': 'super_admin', 'x-admin-user-id': superAdmin.id };
  const globalOperationRunId = Date.now();
  const releaseFixture = await createL43PendingCommissionFixture(`l43-release-due-e2e-${globalOperationRunId}-`, 111);
  const releaseCheck = await assertGlobalOperationRelease('/api/admin/rewards/release-due', releaseFixture, superAdminHeaders, 'releaseResult');
  const settleFixture = await createL43PendingCommissionFixture(`l43-settle-e2e-${globalOperationRunId}-`, 222);
  const settleCheck = await assertGlobalOperationRelease('/api/admin/commissions/settle', settleFixture, superAdminHeaders, 'settleResult');
  const backfillFixture = await createL43AvailableWithoutLedgerFixture(`l43-backfill-e2e-${globalOperationRunId}-`, 333);
  const backfillCheck = await assertGlobalOperationBackfill(backfillFixture, superAdminHeaders);
  assert(settleCheck.first.matched_count >= 1, `settleResult matched_count must be >= 1; actual=${settleCheck.first.matched_count}; fixture=${settleFixture.commissionId}`);
  assert((settleCheck.first.released_count ?? 0) >= 1, `settleResult released_count must be >= 1; actual=${settleCheck.first.released_count}; fixture=${settleFixture.commissionId}`);
  assert(settleCheck.first.ledger_created_count >= 1, `settleResult ledger_created_count must be >= 1; actual=${settleCheck.first.ledger_created_count}; fixture=${settleFixture.commissionId}`);

  console.log('Reward ledger:');
  console.log(`commission_id=${estimated.id}`);
  console.log('status_after_paid=estimated');
  console.log('status_after_complete=pending');
  console.log(`available_at=${expectedAvailableAt.toISOString()}`);
  console.log('status_before_t3=pending');
  console.log('status_after_t3=available');
  console.log('initial_amount_cents=1000');
  console.log('delivery_refund_adjusted_amount_cents=1000');
  console.log('delivery_refund_deduct_ledger_count=0');
  console.log('product_refund_adjusted_amount_cents=700');
  console.log('refund_deduct_ledger_count=1');
  console.log(`available_balance_after_release_cents=${availableBalanceAfterRelease}`);
  console.log(`available_balance_after_delivery_refund_cents=${availableBalanceAfterDeliveryRefund}`);
  console.log(`available_balance_after_partial_product_refund_cents=${availableBalanceAfterPartialProductRefund}`);
  console.log(`available_balance_after_full_product_refund_cents=${availableBalanceAfterFullProductRefund}`);
  console.log('Global reward authorization:');
  console.log('scoped_finance_release_due_403');
  console.log('scoped_finance_settle_403');
  console.log('scoped_finance_backfill_403');
  console.log('store_manager_global_reward_ops_403');
  console.log('operator_global_reward_ops_403');
  console.log('inactive_admin_global_reward_ops_401');
  console.log('super_admin_global_reward_ops_success');
  console.log(`release_due_matched_count=${releaseCheck.first.matched_count}`);
  console.log(`release_due_released_count=${releaseCheck.first.released_count}`);
  console.log(`release_due_ledger_created_count=${releaseCheck.first.ledger_created_count}`);
  console.log(`release_due_repeat_ledger_created_count=${releaseCheck.repeat.ledger_created_count}`);
  console.log(`release_due_fixture_status=${releaseCheck.fixtureStatus}`);
  console.log(`release_due_fixture_ledger_count=${releaseCheck.fixtureLedgerCount}`);
  console.log(`release_due_fixture_balance_verified=${releaseCheck.fixtureBalanceVerified}`);
  console.log(`settle_matched_count=${settleCheck.first.matched_count}`);
  console.log(`settle_released_count=${settleCheck.first.released_count}`);
  console.log(`settle_ledger_created_count=${settleCheck.first.ledger_created_count}`);
  console.log(`settle_repeat_ledger_created_count=${settleCheck.repeat.ledger_created_count}`);
  console.log(`settle_fixture_status=${settleCheck.fixtureStatus}`);
  console.log(`settle_fixture_ledger_count=${settleCheck.fixtureLedgerCount}`);
  console.log(`settle_fixture_balance_verified=${settleCheck.fixtureBalanceVerified}`);
  console.log(`backfill_matched_count=${backfillCheck.first.matched_count}`);
  console.log(`backfill_ledger_created_count=${backfillCheck.first.ledger_created_count}`);
  console.log(`backfill_repeat_ledger_created_count=${backfillCheck.repeat.ledger_created_count}`);
  console.log(`backfill_fixture_ledger_count=${backfillCheck.fixtureLedgerCount}`);
  console.log(`backfill_fixture_balance_verified=${backfillCheck.fixtureBalanceVerified}`);
  console.log('global_reward_negative_no_commission_change');
  console.log('global_reward_negative_no_ledger_change');
  console.log('global_reward_negative_no_success_event');
}

async function runL44WithdrawalScenario() {
  const runId = `l44-withdrawal-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const financeAHeaders = { 'content-type': 'application/json', 'x-admin-role': 'finance', 'x-admin-user-id': DOCKER_E2E_FINANCE_ADMIN_ID, 'x-admin-community-id': `${runId}-community-a` };
  const financeBHeaders = { 'content-type': 'application/json', 'x-admin-role': 'finance', 'x-admin-user-id': DOCKER_E2E_FINANCE_ADMIN_ID, 'x-admin-community-id': `${runId}-community-b` };
  const storeManagerHeaders = { 'content-type': 'application/json', 'x-admin-role': 'store_manager', 'x-admin-user-id': DOCKER_E2E_STORE_MANAGER_ADMIN_ID, 'x-admin-community-id': `${runId}-community-a` };
  const operatorHeaders = { 'content-type': 'application/json', 'x-admin-role': 'operator', 'x-admin-user-id': DOCKER_E2E_OPERATOR_ADMIN_ID, 'x-admin-community-id': `${runId}-community-a` };
  const inactiveHeaders = { 'content-type': 'application/json', 'x-admin-role': 'finance', 'x-admin-user-id': DOCKER_E2E_INACTIVE_ADMIN_ID, 'x-admin-community-id': `${runId}-community-a` };
  async function createLeader(label: string) {
    return prisma.user.create({ data: { openid: `${runId}-${label}-openid`, nickname: `${runId}-${label}`, role: 'leader', status: 'active' } });
  }
  const leaderMain = await createLeader('main');
  const leaderSameRequest = await createLeader('same-request');
  const leaderCompeting = await createLeader('competing');
  const leaderMismatch = await createLeader('mismatch');
  const leaderRace = await createLeader('race');
  const leaderPaid = await createLeader('paid');
  const leaderScopeA = await createLeader('scope-a');
  const leaderScopeB = await createLeader('scope-b');
  const leaderB = await createLeader('leader-b');
  const customer = await prisma.user.create({ data: { openid: `${runId}-customer`, nickname: `${runId}-Customer`, role: 'customer', status: 'active' } });
  const communityA = await prisma.community.create({ data: { id: `${runId}-community-a`, name: `${runId} Community A`, address: `${runId} Address A` } });
  const communityB = await prisma.community.create({ data: { id: `${runId}-community-b`, name: `${runId} Community B`, address: `${runId} Address B` } });
  const category = await prisma.category.create({ data: { name: `${runId} Category`, status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${runId} Product`, category_id: category.id, price_cents: 1000, cost_price_cents: 500, stock: 100, unit: '份', stock_unit: '份', sale_unit: '份', status: 'active', is_group_enabled: true } });

  async function createCommissionFixture(label: string, leaderId: string, communityId: string, amount: number) {
    const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leaderId, community_id: communityId, min_people: 1, min_quantity: 1, current_people: 1, current_quantity: 1, price_cents: product.price_cents, start_time: new Date(Date.now() - 3600_000), end_time: new Date(Date.now() + 3600_000), pickup_time: new Date(Date.now() + 86400_000), status: 'success' } });
    const order = await prisma.order.create({ data: { order_no: `${runId}-${label}-order`, user_id: customer.id, group_buy_id: groupBuy.id, product_id: product.id, leader_user_id: leaderId, community_id: communityId, total_amount_cents: product.price_cents, product_amount_cents: product.price_cents, pay_amount_cents: product.price_cents, quantity: 1, pay_status: 'paid', order_status: 'completed', refund_status: 'none', paid_at: new Date(), completed_at: new Date(Date.now() - 4 * 86400_000), receiver_name: `${runId} Receiver`, receiver_phone: receiverPhone } });
    const commission = await prisma.commission.create({ data: { leader_user_id: leaderId, order_id: order.id, group_buy_id: groupBuy.id, base_amount_cents: product.price_cents, commission_type: 'fixed', commission_value: amount, estimated_amount_cents: amount, final_amount_cents: amount, status: 'available', available_at: new Date(Date.now() - 3600_000) } });
    await prisma.rewardLedger.create({ data: { leader_user_id: leaderId, commission_id: commission.id, order_id: order.id, idempotency_key: `${runId}-available-${commission.id}`, event_type: 'commission_available', entry_type: 'commission_available', direction: 'in', amount_cents: amount, affects_available_balance: true, balance_after_cents: await getAvailableRewardBalance(prisma, leaderId) + amount, effective_at: new Date(), payload: { runId } } });
    return { groupBuy, order, commission };
  }

  async function createWithdrawalFromCommissions(leader: { id: string; openid: string }, client_request_id: string, commissions: Array<{ id: string }>) {
    return request<{ withdrawal_id: string; amount_cents: number; status: string; idempotent?: boolean; applied?: boolean }>('POST', '/api/leaders/me/withdrawals', { label: `POST /api/leaders/me/withdrawals ${client_request_id}`, headers: { 'x-openid': leader.openid }, body: { client_request_id, commission_ids: commissions.map((item) => item.id), leader_user_id: leaderB.id } });
  }

  const main111 = await createCommissionFixture('main-111', leaderMain.id, communityA.id, 111);
  const main222 = await createCommissionFixture('main-222', leaderMain.id, communityA.id, 222);
  const initialBalance = await getAvailableRewardBalance(prisma, leaderMain.id);
  assert(initialBalance === 333, `L44 initial balance must be 333, got ${initialBalance}`);

  console.log('=== L44 leader identity scenario ===');
  await request<ErrorApiResponse>('GET', '/api/leaders/me/withdrawals', { label: 'L44 missing x-openid withdrawals', expectedStatus: 401 });
  await request<ErrorApiResponse>('GET', '/api/leaders/me/withdrawable-commissions', { label: 'L44 customer withdrawable commissions', expectedStatus: detailContract.error_statuses.includes(403) ? 403 : 403, headers: { 'x-openid': customer.openid } });
  const leaderBCommission = await createCommissionFixture('leader-b-111', leaderB.id, communityB.id, 111);
  const leaderBWithdrawal = await request<{ withdrawal_id: string }>('POST', '/api/leaders/me/withdrawals', { label: 'L44 leader B creates withdrawal', headers: { 'x-openid': leaderB.openid }, body: { client_request_id: `${runId}-leader-b-request`, commission_ids: [leaderBCommission.commission.id] } });
  await request<ErrorApiResponse>('GET', `/api/leaders/me/withdrawals/${leaderBWithdrawal.withdrawal_id}`, { label: 'L44 leader A cannot read leader B withdrawal', expectedStatus: 404, headers: { 'x-openid': leaderMain.openid } });
  console.log('l44_identity_scenario_passed');

  console.log('=== L44 withdrawal creation scenario ===');
  const created = await createWithdrawalFromCommissions(leaderMain, `${runId}-request-main`, [main111.commission, main222.commission]);
  const withdrawalId = created.withdrawal_id;
  const dbWithdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  const linkCount = await prisma.withdrawalCommission.count({ where: { withdrawal_id: withdrawalId } });
  const claimedCommissions = await prisma.commission.findMany({ where: { id: { in: [main111.commission.id, main222.commission.id] } } });
  const reservedLedgers = await prisma.rewardLedger.findMany({ where: { withdrawal_id: withdrawalId, event_type: 'withdrawal_reserved' } });
  const balanceAfterRequest = await getAvailableRewardBalance(prisma, leaderMain.id);
  assert(dbWithdrawal.status === 'pending' && dbWithdrawal.amount_cents === 333 && dbWithdrawal.leader_user_id === leaderMain.id, 'L44 created withdrawal database state must be pending/333/LeaderA');
  assert(linkCount === 2, `L44 WithdrawalCommission count must be 2, got ${linkCount}`);
  assert(claimedCommissions.every((item) => item.status === 'withdrawing' && item.withdrawal_id === withdrawalId), 'L44 commissions must be claimed by withdrawal');
  assert(reservedLedgers.length === 1 && reservedLedgers[0].amount_cents === 333 && reservedLedgers[0].direction === 'out' && reservedLedgers[0].affects_available_balance === true, 'L44 reserve ledger must be exactly one out/333 available-affecting entry');
  assert(balanceAfterRequest === 0, `L44 balance after request must be 0, got ${balanceAfterRequest}`);
  console.log('l44_creation_scenario_passed');

  console.log('=== L44 same request concurrency scenario ===');
  const idemA = await createCommissionFixture('idem-111', leaderSameRequest.id, communityA.id, 111);
  const idemB = await createCommissionFixture('idem-222', leaderSameRequest.id, communityA.id, 222);
  const sameInitialBalance = await getAvailableRewardBalance(prisma, leaderSameRequest.id);
  assert(sameInitialBalance === 333, `same-request initial balance expected=333 actual=${sameInitialBalance}`);
  const sameClientRequestId = `${runId}-same-request`;
  const sameResults = await Promise.allSettled([createWithdrawalFromCommissions(leaderSameRequest, sameClientRequestId, [idemA.commission, idemB.commission]), createWithdrawalFromCommissions(leaderSameRequest, sameClientRequestId, [idemA.commission, idemB.commission])]);
  const sameFulfilled = sameResults.filter((item): item is PromiseFulfilledResult<{ withdrawal_id: string }> => item.status === 'fulfilled');
  assert(sameFulfilled.length === 2, 'L44 same client_request_id concurrent requests must both resolve');
  const sameWithdrawalIds = Array.from(new Set(sameFulfilled.map((item) => item.value.withdrawal_id)));
  const sameWithdrawalCount = await prisma.withdrawal.count({ where: { client_request_id: sameClientRequestId } });
  const sameReservedCount = await prisma.rewardLedger.count({ where: { withdrawal_id: sameWithdrawalIds[0], event_type: 'withdrawal_reserved' } });
  const sameBalanceAfter = await getAvailableRewardBalance(prisma, leaderSameRequest.id);
  assert(sameWithdrawalIds.length === 1 && sameWithdrawalCount === 1 && sameReservedCount === 1, 'L44 same client_request_id concurrency must create one withdrawal/reserved ledger');
  assert(sameBalanceAfter === 0, `same-request balance after concurrency expected=0 actual=${sameBalanceAfter}`);
  console.log('l44_same_request_concurrency_passed');

  console.log('=== L44 competing claim scenario ===');
  const competeA = await createCommissionFixture('compete-111', leaderCompeting.id, communityA.id, 111);
  const competeB = await createCommissionFixture('compete-222', leaderCompeting.id, communityA.id, 222);
  const competing = await Promise.allSettled([createWithdrawalFromCommissions(leaderCompeting, `${runId}-compete-a`, [competeA.commission, competeB.commission]), createWithdrawalFromCommissions(leaderCompeting, `${runId}-compete-b`, [competeA.commission, competeB.commission])]);
  const competingSuccesses = competing.filter((item) => item.status === 'fulfilled') as Array<PromiseFulfilledResult<{ withdrawal_id: string }>>;
  const competingWithdrawalIds = Array.from(new Set(competingSuccesses.map((item) => item.value.withdrawal_id)));
  const competingCommissionState = await prisma.commission.findMany({ where: { id: { in: [competeA.commission.id, competeB.commission.id] } } });
  const competingReservedCount = await prisma.rewardLedger.count({ where: { withdrawal_id: { in: competingWithdrawalIds }, event_type: 'withdrawal_reserved' } });
  assert(competingSuccesses.length === 1 && competingWithdrawalIds.length === 1 && competingReservedCount === 1, 'L44 competing claim must have exactly one success and one reserved ledger');
  assert(new Set(competingCommissionState.map((item) => item.withdrawal_id)).size === 1, 'L44 competing commissions must belong to one withdrawal');
  assert(await getAvailableRewardBalance(prisma, leaderCompeting.id) >= 0, 'L44 competing claim must not make balance negative');
  console.log('l44_competing_claim_passed');

  console.log('=== L44 ledger mismatch scenario ===');
  const mismatch = await createCommissionFixture('mismatch-123', leaderMismatch.id, communityA.id, 123);
  await prisma.rewardLedger.create({ data: { leader_user_id: leaderMismatch.id, commission_id: mismatch.commission.id, order_id: mismatch.order.id, idempotency_key: `${runId}-mismatch-extra-${mismatch.commission.id}`, event_type: 'commission_refund_deduct', entry_type: 'commission_refund_deduct', direction: 'out', amount_cents: 1, affects_available_balance: true, balance_after_cents: await getAvailableRewardBalance(prisma, leaderMismatch.id) - 1, effective_at: new Date(), payload: { runId } } });
  const mismatchEventsBefore = await prisma.businessEventLog.count({ where: { leader_user_id: leaderMismatch.id, event_type: 'withdrawal_ledger_mismatch' } });
  await request<ErrorApiResponse>('POST', '/api/leaders/me/withdrawals', { label: 'L44 mismatch withdrawal rejected', expectedStatus: 400, headers: { 'x-openid': leaderMismatch.openid }, body: { client_request_id: `${runId}-mismatch-request`, commission_ids: [mismatch.commission.id] } });
  const mismatchEventsAfter = await prisma.businessEventLog.count({ where: { leader_user_id: leaderMismatch.id, event_type: 'withdrawal_ledger_mismatch' } });
  const mismatchCommissionAfter = await prisma.commission.findUniqueOrThrow({ where: { id: mismatch.commission.id } });
  assert(mismatchEventsAfter - mismatchEventsBefore === 1 && mismatchCommissionAfter.status === 'available' && mismatchCommissionAfter.withdrawal_id === null, 'L44 mismatch must persist warning and avoid claim');
  console.log('l44_ledger_mismatch_passed');

  console.log('=== L44 rejection restore scenario ===');
  const balanceBeforeReject = await getAvailableRewardBalance(prisma, leaderMain.id);
  await request<{ withdrawal: { status: string }; idempotent: boolean }>('POST', `/api/admin/withdrawals/${withdrawalId}/reject`, withAdminJson({ label: 'L44 reject main withdrawal', body: { reason: `${runId}-reject` } }));
  const rejectedWithdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  const rejectedLinks = await prisma.withdrawalCommission.count({ where: { withdrawal_id: withdrawalId } });
  const restoredCommissions = await prisma.commission.findMany({ where: { id: { in: [main111.commission.id, main222.commission.id] } } });
  const restoreLedgerCount = await prisma.rewardLedger.count({ where: { withdrawal_id: withdrawalId, event_type: 'withdrawal_rejected_restore' } });
  const balanceAfterReject = await getAvailableRewardBalance(prisma, leaderMain.id);
  assert(rejectedWithdrawal.status === 'rejected', `reject status expected=rejected actual=${rejectedWithdrawal.status}`);
  assert(rejectedLinks === 2, `reject persistent links expected=2 actual=${rejectedLinks}`);
  const commissionsRestored = restoredCommissions.every((item) => item.status === 'available' && item.withdrawal_id === null);
  assert(commissionsRestored, `reject commissions not restored: ${JSON.stringify(restoredCommissions.map((item) => ({ id: item.id, status: item.status, withdrawal_id: item.withdrawal_id })))}`);
  assert(restoreLedgerCount === 1, `reject restore ledger expected=1 actual=${restoreLedgerCount}`);
  assert(balanceAfterReject - balanceBeforeReject === 333, ['reject must restore exactly withdrawal amount', `before=${balanceBeforeReject}`, `after=${balanceAfterReject}`, `delta=${balanceAfterReject - balanceBeforeReject}`, 'expected_delta=333'].join(' '));
  assert(balanceAfterReject === 333, `isolated main leader balance after reject expected=333 actual=${balanceAfterReject}`);
  const balanceAfterFirstReject = balanceAfterReject;
  const restoreLedgerAfterFirstReject = restoreLedgerCount;
  const rejectAuditAfterFirstReject = await prisma.adminAuditLog.count({ where: { target_type: 'Withdrawal', target_id: withdrawalId, action: 'withdrawal_rejected' } });
  const rejectEventAfterFirstReject = await prisma.businessEventLog.count({ where: { withdrawal_id: withdrawalId, event_type: 'withdrawal_rejected' } });
  const repeatReject = await request<{ withdrawal: { status: string }; idempotent: boolean }>('POST', `/api/admin/withdrawals/${withdrawalId}/reject`, withAdminJson({ label: 'L44 repeat reject idempotent', body: { reason: `${runId}-reject-repeat` } }));
  assert(repeatReject.idempotent === true, 'repeat reject must return idempotent=true');
  assert(await getAvailableRewardBalance(prisma, leaderMain.id) === balanceAfterFirstReject, 'repeat reject must not change balance');
  assert(await prisma.rewardLedger.count({ where: { withdrawal_id: withdrawalId, event_type: 'withdrawal_rejected_restore' } }) === restoreLedgerAfterFirstReject, 'repeat reject must not duplicate restore ledger');
  assert(await prisma.adminAuditLog.count({ where: { target_type: 'Withdrawal', target_id: withdrawalId, action: 'withdrawal_rejected' } }) === rejectAuditAfterFirstReject, 'repeat reject must not duplicate success audit');
  assert(await prisma.businessEventLog.count({ where: { withdrawal_id: withdrawalId, event_type: 'withdrawal_rejected' } }) === rejectEventAfterFirstReject, 'repeat reject must not duplicate success event');
  console.log('l44_rejection_restore_passed');

  console.log('=== L44 approve reject race scenario ===');
  const raceA = await createCommissionFixture('race-111', leaderRace.id, communityA.id, 111);
  const raceW = await createWithdrawalFromCommissions(leaderRace, `${runId}-race-request`, [raceA.commission]);
  const raceResults = await Promise.allSettled([
    request<{ withdrawal: { status: string }; idempotent: boolean }>('POST', `/api/admin/withdrawals/${raceW.withdrawal_id}/approve`, withAdminJson({ label: 'L44 race approve', body: { remark: `${runId}-approve` } })),
    request<{ withdrawal: { status: string }; idempotent: boolean }>('POST', `/api/admin/withdrawals/${raceW.withdrawal_id}/reject`, withAdminJson({ label: 'L44 race reject', body: { reason: `${runId}-reject-race` } }))
  ]);
  const fulfilledResults = raceResults.filter((item) => item.status === 'fulfilled');
  const rejectedResults = raceResults.filter((item) => item.status === 'rejected');
  const raceSuccessCount = fulfilledResults.length;
  const raceFinal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: raceW.withdrawal_id } });
  const approvedRootEvents = await prisma.businessEventLog.count({ where: { withdrawal_id: raceW.withdrawal_id, event_type: 'withdrawal_approved', order_id: null } });
  const approvedOrderEvents = await prisma.businessEventLog.count({ where: { withdrawal_id: raceW.withdrawal_id, event_type: 'withdrawal_approved', order_id: raceA.order.id } });
  const rejectedRootEvents = await prisma.businessEventLog.count({ where: { withdrawal_id: raceW.withdrawal_id, event_type: 'withdrawal_rejected', order_id: null } });
  const rejectedOrderEvents = await prisma.businessEventLog.count({ where: { withdrawal_id: raceW.withdrawal_id, event_type: 'withdrawal_rejected', order_id: raceA.order.id } });
  const approvedAudits = await prisma.adminAuditLog.count({ where: { target_type: 'Withdrawal', target_id: raceW.withdrawal_id, action: 'withdrawal_approved' } });
  const rejectedAudits = await prisma.adminAuditLog.count({ where: { target_type: 'Withdrawal', target_id: raceW.withdrawal_id, action: 'withdrawal_rejected' } });
  const raceTimelines = await prisma.orderTimelineLog.findMany({ where: { order_id: raceA.order.id, event_type: { in: ['withdrawal_approved', 'withdrawal_rejected'] } }, orderBy: { created_at: 'asc' } });
  assert(fulfilledResults.length === 1, ['race must have exactly one fulfilled request', `actual=${fulfilledResults.length}`, `results=${JSON.stringify(raceResults.map((item) => item.status === 'fulfilled' ? { status: item.status, value: item.value } : { status: item.status, reason: item.reason instanceof Error ? item.reason.message : String(item.reason) }))}`].join(' '));
  assert(rejectedResults.length === 1, `race must have exactly one rejected request actual=${rejectedResults.length}`);
  assert(raceFinal.status === 'approved' || raceFinal.status === 'rejected', `race final status invalid actual=${raceFinal.status}`);
  assert(!((approvedRootEvents > 0 || approvedOrderEvents > 0) && (rejectedRootEvents > 0 || rejectedOrderEvents > 0)), ['L44 approve/reject race must not write both approved and rejected success events', `approved_root=${approvedRootEvents}`, `approved_order=${approvedOrderEvents}`, `rejected_root=${rejectedRootEvents}`, `rejected_order=${rejectedOrderEvents}`].join(' '));
  if (raceFinal.status === 'approved') {
    assert(approvedRootEvents === 1, `approved root event expected=1 actual=${approvedRootEvents}`);
    assert(approvedOrderEvents === 1, `approved order event expected=1 actual=${approvedOrderEvents}`);
    assert(rejectedRootEvents === 0, `approved winner must not write rejected root event actual=${rejectedRootEvents}`);
    assert(rejectedOrderEvents === 0, `approved winner must not write rejected order event actual=${rejectedOrderEvents}`);
    assert(approvedAudits === 1 && rejectedAudits === 0, ['approved winner audit mismatch', `approved=${approvedAudits}`, `rejected=${rejectedAudits}`].join(' '));
    assert(raceTimelines.length === 1 && raceTimelines[0].event_type === 'withdrawal_approved', ['approved winner timeline mismatch', `count=${raceTimelines.length}`, `types=${raceTimelines.map((item) => item.event_type).join(',')}`].join(' '));
    const raceCommission = await prisma.commission.findUniqueOrThrow({ where: { id: raceA.commission.id } });
    assert(raceCommission.status === 'withdrawing' && raceCommission.withdrawal_id === raceW.withdrawal_id, ['approved winner must retain reserved commission', `status=${raceCommission.status}`, `withdrawal_id=${raceCommission.withdrawal_id}`].join(' '));
    const restoreCount = await prisma.rewardLedger.count({ where: { withdrawal_id: raceW.withdrawal_id, event_type: 'withdrawal_rejected_restore' } });
    assert(restoreCount === 0, `approved winner restore ledger expected=0 actual=${restoreCount}`);
    const balance = await getAvailableRewardBalance(prisma, leaderRace.id);
    assert(balance === 0, `approved winner balance expected=0 actual=${balance}`);
  }
  if (raceFinal.status === 'rejected') {
    assert(rejectedRootEvents === 1, `rejected root event expected=1 actual=${rejectedRootEvents}`);
    assert(rejectedOrderEvents === 1, `rejected order event expected=1 actual=${rejectedOrderEvents}`);
    assert(approvedRootEvents === 0, `rejected winner must not write approved root event actual=${approvedRootEvents}`);
    assert(approvedOrderEvents === 0, `rejected winner must not write approved order event actual=${approvedOrderEvents}`);
    assert(rejectedAudits === 1 && approvedAudits === 0, ['rejected winner audit mismatch', `approved=${approvedAudits}`, `rejected=${rejectedAudits}`].join(' '));
    assert(raceTimelines.length === 1 && raceTimelines[0].event_type === 'withdrawal_rejected', ['rejected winner timeline mismatch', `count=${raceTimelines.length}`, `types=${raceTimelines.map((item) => item.event_type).join(',')}`].join(' '));
    const raceCommission = await prisma.commission.findUniqueOrThrow({ where: { id: raceA.commission.id } });
    assert(raceCommission.status === 'available' && raceCommission.withdrawal_id === null, ['rejected winner must restore commission', `status=${raceCommission.status}`, `withdrawal_id=${raceCommission.withdrawal_id}`].join(' '));
    const restoreCount = await prisma.rewardLedger.count({ where: { withdrawal_id: raceW.withdrawal_id, event_type: 'withdrawal_rejected_restore' } });
    assert(restoreCount === 1, `rejected winner restore ledger expected=1 actual=${restoreCount}`);
    const balance = await getAvailableRewardBalance(prisma, leaderRace.id);
    assert(balance === 111, `rejected winner balance expected=111 actual=${balance}`);
  }
  console.log('L44 approve/reject race diagnostics:');
  console.log(`race_final_status=${raceFinal.status}`);
  console.log(`race_fulfilled_count=${fulfilledResults.length}`);
  console.log(`race_rejected_count=${rejectedResults.length}`);
  console.log(`race_approved_root_events=${approvedRootEvents}`);
  console.log(`race_approved_order_events=${approvedOrderEvents}`);
  console.log(`race_rejected_root_events=${rejectedRootEvents}`);
  console.log(`race_rejected_order_events=${rejectedOrderEvents}`);
  console.log(`race_approved_audits=${approvedAudits}`);
  console.log(`race_rejected_audits=${rejectedAudits}`);
  console.log(`race_timeline_types=${raceTimelines.map((item) => item.event_type).join(',')}`);
  console.log('l44_approve_reject_race_passed');

  console.log('=== L44 paid scenario ===');
  const paidA = await createCommissionFixture('paid-111', leaderPaid.id, communityA.id, 111);
  const paidB = await createCommissionFixture('paid-222', leaderPaid.id, communityA.id, 222);
  const paidW = await createWithdrawalFromCommissions(leaderPaid, `${runId}-paid-request`, [paidA.commission, paidB.commission]);
  await request<{ withdrawal: { status: string }; idempotent: boolean }>('POST', `/api/admin/withdrawals/${paidW.withdrawal_id}/approve`, withAdminJson({ label: 'L44 approve paid withdrawal', body: { remark: `${runId}-approve-paid` } }));
  const paidWBeforeTax = await prisma.withdrawal.findUniqueOrThrow({ where: { id: paidW.withdrawal_id } });
  await request('POST', `/api/admin/withdrawals/${paidW.withdrawal_id}/tax-review`, withAdminJson({ label: 'L44 tax compatibility none', body: { tax_mode: 'none', taxable_amount_cents: paidWBeforeTax.amount_cents, tax_amount_cents: 0, client_request_id: `${runId}-paid-tax-none`, expected_updated_at: paidWBeforeTax.updated_at.toISOString() } }));
  const markPaid = await request<{ withdrawal: { status: string }; idempotent: boolean }>('POST', `/api/admin/withdrawals/${paidW.withdrawal_id}/mark-paid`, withAdminJson({ label: 'L44 mark paid', body: { manual_reference: `${runId}-manual-reference`, remark: `${runId}-paid` } }));
  const paidFinal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: paidW.withdrawal_id } });
  const paidCommissions = await prisma.commission.findMany({ where: { withdrawal_id: paidW.withdrawal_id } });
  const paidLedgers = await prisma.rewardLedger.findMany({ where: { withdrawal_id: paidW.withdrawal_id, event_type: 'withdrawal_paid' } });
  const balanceAfterPaid = await getAvailableRewardBalance(prisma, leaderPaid.id);
  assert(markPaid.withdrawal.status === 'paid' && paidFinal.status === 'paid' && paidFinal.manual_reference === `${runId}-manual-reference` && paidFinal.processed_at && paidFinal.processed_by_admin_id === DOCKER_E2E_ADMIN_ID, 'L44 mark-paid must persist manual processing metadata');
  assert(paidCommissions.every((item) => item.status === 'withdrawn') && paidLedgers.length === 1 && paidLedgers[0].affects_available_balance === false && balanceAfterPaid >= 0, 'L44 paid must withdraw commissions and not affect available balance again');
  const paidAuditBefore = await prisma.adminAuditLog.count({ where: { target_type: 'Withdrawal', target_id: paidW.withdrawal_id, action: 'withdrawal_mark_paid' } });
  const repeatPaid = await request<{ withdrawal: { status: string }; idempotent: boolean }>('POST', `/api/admin/withdrawals/${paidW.withdrawal_id}/mark-paid`, withAdminJson({ label: 'L44 repeat mark paid', body: { manual_reference: `${runId}-manual-reference`, remark: `${runId}-paid-repeat` } }));
  assert(repeatPaid.idempotent === true && await prisma.rewardLedger.count({ where: { withdrawal_id: paidW.withdrawal_id, event_type: 'withdrawal_paid' } }) === 1 && await prisma.adminAuditLog.count({ where: { target_type: 'Withdrawal', target_id: paidW.withdrawal_id, action: 'withdrawal_mark_paid' } }) === paidAuditBefore, 'L44 repeat mark-paid must not duplicate ledger/audit');
  console.log('l44_paid_scenario_passed');

  console.log('=== L44 withdrawal authorization scenario ===');
  const scopeA1 = await createCommissionFixture('scope-a-111', leaderScopeA.id, communityA.id, 111);
  const scopeB1 = await createCommissionFixture('scope-b-111', leaderScopeB.id, communityB.id, 111);
  const scopeAW = await createWithdrawalFromCommissions(leaderScopeA, `${runId}-scope-a`, [scopeA1.commission]);
  assert(scopeAW.withdrawal_id, 'L44 scope A withdrawal must be created');
  const scopeBW = await createWithdrawalFromCommissions(leaderScopeB, `${runId}-scope-b`, [scopeB1.commission]);
  const financeAList = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/withdrawals?keyword=${encodeURIComponent(runId)}&page=1&page_size=1`, { label: 'L44 scoped finance A list page 1', headers: financeAHeaders });
  const financeAListPage2 = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/withdrawals?keyword=${encodeURIComponent(runId)}&page=2&page_size=1`, { label: 'L44 scoped finance A list page 2', headers: financeAHeaders });
  assert(financeAList.total >= 1 && financeAList.items.every((item) => item.withdrawal_id !== scopeBW.withdrawal_id) && financeAListPage2.items.every((item) => item.withdrawal_id !== scopeBW.withdrawal_id), 'L44 scoped finance A list must filter B withdrawals with correct total/pages');
  const negativeBefore = { withdrawal: await prisma.withdrawal.findUnique({ where: { id: scopeBW.withdrawal_id } }), links: await prisma.withdrawalCommission.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }), commissions: await prisma.commission.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }), ledger: await prisma.rewardLedger.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }), audit: await prisma.adminAuditLog.count({ where: { target_id: scopeBW.withdrawal_id } }), events: await prisma.businessEventLog.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }) };
  await request<ErrorApiResponse>('GET', `/api/admin/withdrawals/${scopeBW.withdrawal_id}`, { label: 'L44 scoped finance A detail B denied', expectedStatus: 403, headers: financeAHeaders });
  await request<ErrorApiResponse>('POST', `/api/admin/withdrawals/${scopeBW.withdrawal_id}/approve`, { label: 'L44 scoped finance A approve B denied', expectedStatus: 403, headers: financeAHeaders, body: { remark: `${runId}-denied` } });
  await request<ErrorApiResponse>('GET', '/api/admin/withdrawals', { label: 'L44 store manager withdrawal forbidden', expectedStatus: 403, headers: storeManagerHeaders });
  await request<ErrorApiResponse>('GET', '/api/admin/withdrawals', { label: 'L44 operator withdrawal forbidden', expectedStatus: 403, headers: operatorHeaders });
  await request<ErrorApiResponse>('GET', '/api/admin/withdrawals', { label: 'L44 inactive admin withdrawal unauthorized', expectedStatus: 401, headers: inactiveHeaders });
  await request<ErrorApiResponse>('GET', '/api/admin/withdrawals', { label: 'L44 missing admin withdrawal unauthorized', expectedStatus: 401 });
  const negativeAfter = { withdrawal: await prisma.withdrawal.findUnique({ where: { id: scopeBW.withdrawal_id } }), links: await prisma.withdrawalCommission.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }), commissions: await prisma.commission.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }), ledger: await prisma.rewardLedger.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }), audit: await prisma.adminAuditLog.count({ where: { target_id: scopeBW.withdrawal_id } }), events: await prisma.businessEventLog.count({ where: { withdrawal_id: scopeBW.withdrawal_id } }) };
  assert(JSON.stringify(negativeBefore) === JSON.stringify(negativeAfter), 'L44 negative authorization calls must not mutate withdrawal/link/commission/ledger/audit/event snapshots');
  const taxRecord = await prisma.taxRecord.create({ data: { leader_user_id: leaderScopeB.id, source_type: 'withdrawal', source_id: scopeBW.withdrawal_id, tax_mode: 'none', tax_status: 'completed', amount_cents: 111, payload: { runId } } });
  type TaxRecordPage = { items: Array<{ tax_record_id: string; withdrawal_id: string | null }>; total: number; page: number; page_size: number };
  const taxRecordsA = await request<TaxRecordPage>('GET', `/api/admin/tax-records?source_type=withdrawal&source_id=${scopeBW.withdrawal_id}`, { label: 'L44 tax records scoped finance A excludes B', headers: financeAHeaders });
  const taxRecordsB = await request<TaxRecordPage>('GET', `/api/admin/tax-records?source_type=withdrawal&source_id=${scopeBW.withdrawal_id}`, { label: 'L44 tax records scoped finance B includes B', headers: financeBHeaders });
  assert(Array.isArray(taxRecordsA.items) && taxRecordsA.total === 0 && taxRecordsA.items.length === 0, 'L44 scoped finance A tax-record page must exclude the scope B record');
  assert(Array.isArray(taxRecordsB.items) && taxRecordsB.total === 1 && taxRecordsB.items.length === 1 && taxRecordsB.items[0].tax_record_id === taxRecord.id && taxRecordsB.items[0].withdrawal_id === scopeBW.withdrawal_id, 'L44 scoped finance B tax-record page must include the exact scope B record');
  console.log('l44_authorization_scenario_passed');

  const withdrawalReservedAmount = reservedLedgers[0].amount_cents;
  const sameRequestConcurrentCount = sameWithdrawalCount;
  const competingSuccessCount = competingSuccesses.length;
  const mismatchEventCount = mismatchEventsAfter - mismatchEventsBefore;
  const paidLedgerCount = paidLedgers.length;
  const repeatNoDuplicate = repeatPaid.idempotent === true;
  console.log('L44 manual withdrawal review:');
  console.log(`withdrawal_initial_available_balance_cents=${initialBalance}`);
  console.log(`withdrawal_reserved_amount_cents=${withdrawalReservedAmount}`);
  console.log(`withdrawal_balance_after_request_cents=${balanceAfterRequest}`);
  console.log(`withdrawal_same_request_idempotent=${sameWithdrawalIds.length === 1}`);
  console.log(`withdrawal_same_request_concurrent_count=${sameRequestConcurrentCount}`);
  console.log(`withdrawal_competing_request_success_count=${competingSuccessCount}`);
  console.log(`withdrawal_link_count=${linkCount}`);
  console.log(`withdrawal_ledger_mismatch_event_count=${mismatchEventCount}`);
  console.log(`withdrawal_rejected_restore_ledger_count=${restoreLedgerCount}`);
  console.log(`withdrawal_balance_after_reject_cents=${balanceAfterReject}`);
  console.log(`withdrawal_approve_reject_success_count=${raceSuccessCount}`);
  console.log(`withdrawal_approved_status=${raceFinal.status === 'approved' ? 'approved' : 'rejected'}`);
  console.log(`withdrawal_paid_status=${paidFinal.status}`);
  console.log(`withdrawal_balance_after_paid_cents=${balanceAfterPaid}`);
  console.log(`withdrawal_paid_ledger_count=${paidLedgerCount}`);
  console.log(`withdrawal_repeat_no_duplicate=${repeatNoDuplicate}`);
  console.log('\nL44 withdrawal authorization:');
  console.log('leader_missing_identity_401');
  console.log('leader_customer_403');
  console.log('leader_cross_account_denied');
  console.log('scoped_finance_list_filtered');
  console.log('scoped_finance_cross_scope_403');
  console.log('store_manager_withdrawal_403');
  console.log('operator_withdrawal_403');
  console.log('inactive_admin_withdrawal_401');
  console.log('withdrawal_negative_no_db_mutation');
}
async function runL45TaxReviewScenario() {
  console.log('=== L45 manual tax review export scenario ===');
  const runId = `l45-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const product = await prisma.product.findUniqueOrThrow({ where: { id: DOCKER_E2E_PRODUCT_ID } });
  const leaderA = await prisma.user.create({ data: { openid: `${runId}-leader-a`, nickname: '=HYPERLINK("https://example.com")', phone: '13600000001', role: 'leader' } });
  const leaderB = await prisma.user.create({ data: { openid: `${runId}-leader-b`, nickname: '+SUM(1,1)', phone: '13600000002', role: 'leader' } });
  const userA = await prisma.user.create({ data: { openid: `${runId}-user-a`, nickname: 'L45 User A', phone: '13600000003' } });
  const userB = await prisma.user.create({ data: { openid: `${runId}-user-b`, nickname: 'L45 User B', phone: '13600000004' } });
  const communityA = await prisma.community.create({ data: { name: `@cmd-${runId}`, address: 'L45 scope A' } });
  const communityB = await prisma.community.create({ data: { name: `-1+2-${runId}`, address: 'L45 scope B' } });
  async function createWithdrawalFixture(scope: 'a' | 'b', suffix: string, amount = 1000) {
    const leader = scope === 'a' ? leaderA : leaderB;
    const user = scope === 'a' ? userA : userB;
    const community = scope === 'a' ? communityA : communityB;
    const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, price_cents: product.price_cents, start_time: new Date(Date.now() - 3600_000), end_time: new Date(Date.now() + 3600_000), pickup_time: new Date(Date.now() + 86400_000), status: 'success' } });
    const order = await prisma.order.create({ data: { order_no: `${runId}-${suffix}`, user_id: user.id, group_buy_id: groupBuy.id, product_id: product.id, leader_user_id: leader.id, community_id: community.id, total_amount_cents: amount, product_amount_cents: amount, pay_amount_cents: amount, quantity: 1, pay_status: 'paid', order_status: 'completed', refund_status: 'none', paid_at: new Date(Date.now() - 1200_000), completed_at: new Date(Date.now() - 600_000), receiver_name: 'L45', receiver_phone: '13600000005' } });
    const commission = await prisma.commission.create({ data: { leader_user_id: leader.id, order_id: order.id, group_buy_id: groupBuy.id, base_amount_cents: amount, commission_type: 'fixed', commission_value: amount, estimated_amount_cents: amount, final_amount_cents: amount, status: 'withdrawing', available_at: new Date(Date.now() - 300_000), review_status: 'approved' } });
    const withdrawal = await prisma.withdrawal.create({ data: { leader_user_id: leader.id, amount_cents: amount, status: 'approved', client_request_id: suffix === 'danger-a' ? `\tclient-danger-${runId}` : `${runId}-${suffix}-withdrawal`, tax_mode: 'pending_review', tax_status: 'pending', taxable_amount_cents: amount, tax_amount_cents: 0, payable_amount_cents: amount } });
    await prisma.withdrawalCommission.create({ data: { withdrawal_id: withdrawal.id, commission_id: commission.id, amount_cents: amount } });
    const taxRecord = await prisma.taxRecord.create({ data: { leader_user_id: leader.id, source_type: 'withdrawal', source_id: withdrawal.id, tax_mode: withdrawal.tax_mode, tax_status: withdrawal.tax_status, amount_cents: amount, payload: { tax_remark: '\r\nleading-newline', tax_rate_basis: '-1+2' } } });
    return { withdrawal, taxRecord, order, community };
  }
  assert(ensureTaxExportWithinLimit([1, 2, 3], 3).length === 3, 'L45 export limit helper must allow exactly limit rows');
  let exportLimitRejected = false;
  try { ensureTaxExportWithinLimit([1, 2, 3, 4], 3); } catch (error) { exportLimitRejected = (error as { statusCode?: number }).statusCode === 422; }
  assert(exportLimitRejected, 'L45 export limit helper must reject limit + 1 rows');
  console.log('l45_export_limit_helper_guard=true');
  const fixtureA = await createWithdrawalFixture('a', 'danger-a', 1000);
  const fixtureB = await createWithdrawalFixture('b', 'danger-b', 2000);
  const fixtureC = await createWithdrawalFixture('a', 'concurrent', 1200);
  const financeAHeaders = { ...adminHeaders, 'x-admin-role': 'finance', 'x-admin-community-id': communityA.id };
  const financeNoScopeHeaders = { ...adminHeaders, 'x-admin-role': 'finance' };
  const financeBHeaders = { ...adminHeaders, 'x-admin-role': 'finance', 'x-admin-community-id': communityB.id };
  const listContract = L45_API_CONTRACT.tax_record_list;
  const detailContract = L45_API_CONTRACT.tax_record_detail;
  const exportContract = L45_API_CONTRACT.tax_record_export;
  const taxReviewContract = L45_API_CONTRACT.tax_review;
  const markPaidContract = L45_API_CONTRACT.mark_paid;

  const financeList = await request<{ items: Array<{ withdrawal_id: string; leader_phone_masked?: string }>; total: number; page: number; page_size: number }>(listContract.method, `${listContract.path}?page=1&page_size=1`, { label: 'GET /api/admin/tax-records L45 finance', headers: financeAHeaders });
  assert(financeList.total === 2 && financeList.items.length === 1 && financeList.page === 1 && financeList.page_size === 1, 'L45 finance list must return the two scoped fixtures with database count/skip/take pagination');
  assert(financeList.items.every((item) => item.leader_phone_masked?.includes('****')), 'L45 list must mask leader phone');
  console.log('l45_tax_list_scope_success=true');
  const page2 = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>(listContract.method, `${listContract.path}?page=2&page_size=1`, { label: 'GET /api/admin/tax-records L45 page 2', headers: financeAHeaders });
  assert(page2.total === financeList.total && page2.items.length === 1 && page2.items[0].withdrawal_id !== financeList.items[0].withdrawal_id, 'L45 pagination must use database skip/take');
  const filtered = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>(listContract.method, `${listContract.path}?tax_status=pending&tax_mode=pending_review&invoice_status=not_required&from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400_000).toISOString())}&withdrawal_id=${encodeURIComponent(fixtureA.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 filters', headers: financeAHeaders });
  assert(filtered.total === 1 && filtered.items.length === 1 && filtered.items[0].withdrawal_id === fixtureA.withdrawal.id, 'L45 status/mode/invoice/date/withdrawal filters and scope must apply');
  const keywordFiltered = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>(listContract.method, `${listContract.path}?keyword=${encodeURIComponent(fixtureA.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 keyword', headers: financeAHeaders });
  assert(keywordFiltered.total === 1 && keywordFiltered.items.length === 1 && keywordFiltered.items[0].withdrawal_id === fixtureA.withdrawal.id, 'L45 keyword must match the explicitly searchable withdrawal id fixture');
  const scopeAAll = await request<{ items: Array<{ withdrawal_id: string }> }>(listContract.method, `${listContract.path}?page=1&page_size=20`, { label: 'GET /api/admin/tax-records L45 scope A', headers: financeAHeaders });
  assert(scopeAAll.items.some((item) => item.withdrawal_id === fixtureA.withdrawal.id) && !scopeAAll.items.some((item) => item.withdrawal_id === fixtureB.withdrawal.id), 'L45 scope A must only see scope A');
  await request<ErrorApiResponse>(detailContract.method, `${detailContract.path.replace(':id', fixtureB.taxRecord.id)}`, { label: 'GET /api/admin/tax-records/:id L45 cross scope', headers: financeAHeaders, expectedStatus: 403 });
  await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureB.withdrawal.id)}`, { label: 'POST /api/admin/withdrawals/:id/tax-review L45 cross scope', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 403, body: { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 0, client_request_id: `${runId}-cross-scope`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() } });
  const noScope = await request<{ items: unknown[]; total: number }>(listContract.method, `${listContract.path}?page=1&page_size=20`, { label: 'GET /api/admin/tax-records L45 finance no scope', headers: financeNoScopeHeaders });
  assert(noScope.total === 0 && noScope.items.length === 0, 'L45 no-scope finance must return empty list');
  await request<ErrorApiResponse>(listContract.method, listContract.path, { label: 'GET /api/admin/tax-records L45 store_manager', headers: { ...adminHeaders, 'x-admin-role': 'store_manager', 'x-admin-user-id': DOCKER_E2E_STORE_MANAGER_ADMIN_ID }, expectedStatus: 403 });
  await request<ErrorApiResponse>(listContract.method, listContract.path, { label: 'GET /api/admin/tax-records L45 operator', headers: { ...adminHeaders, 'x-admin-role': 'operator', 'x-admin-user-id': DOCKER_E2E_OPERATOR_ADMIN_ID }, expectedStatus: 403 });
  await request<ErrorApiResponse>(listContract.method, listContract.path, { label: 'GET /api/admin/tax-records L45 inactive admin', headers: { ...adminHeaders, 'x-admin-role': 'finance', 'x-admin-user-id': DOCKER_E2E_INACTIVE_ADMIN_ID }, expectedStatus: 401 });
  const superAdminA = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>(listContract.method, `${listContract.path}?withdrawal_id=${encodeURIComponent(fixtureA.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 super_admin scope A', headers: adminHeaders });
  const superAdminB = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>(listContract.method, `${listContract.path}?withdrawal_id=${encodeURIComponent(fixtureB.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 super_admin scope B', headers: adminHeaders });
  assert(superAdminA.total === 1 && superAdminA.items[0]?.withdrawal_id === fixtureA.withdrawal.id && superAdminB.total === 1 && superAdminB.items[0]?.withdrawal_id === fixtureB.withdrawal.id, 'L45 super_admin must read explicit fixtures from both scopes');

  const beforeAudit = await prisma.adminAuditLog.count({ where: { target_id: fixtureA.withdrawal.id, action: 'withdrawal_tax_reviewed' } });
  const beforeEvent = await prisma.businessEventLog.count({ where: { withdrawal_id: fixtureA.withdrawal.id, event_type: 'withdrawal_tax_reviewed', order_id: null } });
  const reviewPayload = { tax_mode: 'withheld', taxable_amount_cents: 1000, tax_amount_cents: 120, tax_rate_basis: '-1+2', invoice_status: 'not_required', tax_remark: '@cmd', client_request_id: `${runId}-review`, expected_updated_at: fixtureA.withdrawal.updated_at.toISOString() };
  await request(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureA.withdrawal.id)}`, { label: 'POST /api/admin/withdrawals/:id/tax-review L45 success', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: reviewPayload });
  const updatedA = await prisma.withdrawal.findUniqueOrThrow({ where: { id: fixtureA.withdrawal.id } });
  const taxRecordA = await prisma.taxRecord.findUniqueOrThrow({ where: { source_type_source_id: { source_type: 'withdrawal', source_id: fixtureA.withdrawal.id } } });
  console.log('l45_tax_review_success=true');
  assert(updatedA.tax_mode === 'withheld' && updatedA.tax_status === 'calculated' && updatedA.taxable_amount_cents === 1000 && updatedA.tax_amount_cents === 120 && updatedA.payable_amount_cents === 880, 'L45 valid review must update Withdrawal tax fields');
  assert(taxRecordA.tax_mode === 'withheld' && taxRecordA.tax_status === 'calculated' && taxRecordA.amount_cents === 1000, 'L45 valid review must upsert TaxRecord');
  assert(await prisma.adminAuditLog.count({ where: { target_id: fixtureA.withdrawal.id, action: 'withdrawal_tax_reviewed' } }) === beforeAudit + 1, 'L45 valid review must create exactly one AdminAuditLog');
  assert(await prisma.businessEventLog.count({ where: { withdrawal_id: fixtureA.withdrawal.id, event_type: 'withdrawal_tax_reviewed', order_id: null } }) === beforeEvent + 1, 'L45 valid review must create exactly one root BusinessEventLog');
  const detailA = await request<{ tax_record_id: string; withdrawal_id: string; updated_at?: string; leader_phone_masked?: string; commissions: Array<{ commission_id: string; order_no: string; product_name: string; community_name: string; reward_amount_cents: number }>; admin_audits: Array<{ action: string }>; business_events: Array<{ event_type: string }> }>(detailContract.method, `${detailContract.path.replace(':id', taxRecordA.id)}`, { label: 'GET /api/admin/tax-records/:id L45 detail success', headers: financeAHeaders });
  assert(detailA.tax_record_id === taxRecordA.id && detailA.withdrawal_id === fixtureA.withdrawal.id && Boolean(detailA.updated_at), 'L45 detail must return exact ids and updated_at');
  assert(detailA.leader_phone_masked?.includes('****') && !JSON.stringify(detailA).includes('13600000001'), 'L45 detail must mask raw leader phone');
  assert(detailA.commissions.some((item) => item.order_no === fixtureA.order.order_no && item.product_name && item.community_name && item.reward_amount_cents === 1000), 'L45 detail must include commission/order/product/community context');
  assert(detailA.admin_audits.some((item) => item.action === 'withdrawal_tax_reviewed') && detailA.business_events.some((item) => item.event_type === 'withdrawal_tax_reviewed'), 'L45 detail must include review audit and business event');
  console.log('l45_tax_detail_success=true');

  const reorderedReviewPayload = {
    client_request_id: reviewPayload.client_request_id,
    tax_remark: reviewPayload.tax_remark,
    invoice_status: reviewPayload.invoice_status,
    tax_rate_basis: reviewPayload.tax_rate_basis,
    tax_amount_cents: reviewPayload.tax_amount_cents,
    taxable_amount_cents: reviewPayload.taxable_amount_cents,
    tax_mode: reviewPayload.tax_mode,
    expected_updated_at: reviewPayload.expected_updated_at,
  };
  const repeat = await request<{ idempotent?: boolean }>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureA.withdrawal.id)}`, { label: 'POST /api/admin/withdrawals/:id/tax-review L45 idempotent repeat', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: reorderedReviewPayload });
  assert(repeat.idempotent === true, 'L45 same client_request_id and semantically identical payload must be idempotent regardless of JSON key order');

  await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureB.withdrawal.id)}`, { label: 'POST tax-review L45 missing key', headers: { ...financeBHeaders, 'content-type': 'application/json' }, expectedStatus: 400, body: { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 0, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() } });
  await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureB.withdrawal.id)}`, { label: 'POST tax-review L45 overlong key', headers: { ...financeBHeaders, 'content-type': 'application/json' }, expectedStatus: 400, body: { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 0, client_request_id: 'x'.repeat(81), expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() } });
  const fixtureE = await createWithdrawalFixture('a', 'none-mark-paid', 1400);
  await request(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureE.withdrawal.id)}`, { label: 'POST tax-review L45 none success', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { tax_mode: 'none', taxable_amount_cents: 1400, tax_amount_cents: 0, client_request_id: `${runId}-none-success`, expected_updated_at: fixtureE.withdrawal.updated_at.toISOString() } });
  const noneReviewed = await prisma.withdrawal.findUniqueOrThrow({ where: { id: fixtureE.withdrawal.id } });
  assert(noneReviewed.tax_status === 'completed' && noneReviewed.tax_amount_cents === 0 && noneReviewed.payable_amount_cents === noneReviewed.amount_cents, 'L45 none mode zero tax must complete and keep payable equal amount');
  const nonePaid = await request<{ withdrawal: { status: string } }>(markPaidContract.method, `${markPaidContract.path.replace(':id', fixtureE.withdrawal.id)}`, { label: 'POST mark-paid L45 none reviewed', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { manual_reference: `${runId}-none-paid` } });
  assert(nonePaid.withdrawal.status === 'paid', 'L45 mark-paid must pass after valid none tax review');
  console.log('l45_mark_paid_success=true');

  const markPending = await createWithdrawalFixture('a', 'mark-pending-tax', 1500);
  const markPendingAuditBefore = await prisma.adminAuditLog.count({ where: { target_id: markPending.withdrawal.id } });
  const markPendingEventBefore = await prisma.businessEventLog.count({ where: { withdrawal_id: markPending.withdrawal.id } });
  await request<ErrorApiResponse>(markPaidContract.method, `${markPaidContract.path.replace(':id', markPending.withdrawal.id)}`, { label: 'POST mark-paid L45 tax pending conflict', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { manual_reference: `${runId}-pending-tax` } });
  assert(await prisma.adminAuditLog.count({ where: { target_id: markPending.withdrawal.id } }) === markPendingAuditBefore && await prisma.businessEventLog.count({ where: { withdrawal_id: markPending.withdrawal.id } }) === markPendingEventBefore, 'L45 mark-paid tax pending conflict must not write audit/event');
  const invoiceConflict = await createWithdrawalFixture('a', 'mark-invoice-pending', 1510);
  await prisma.withdrawal.update({ where: { id: invoiceConflict.withdrawal.id }, data: { tax_mode: 'invoice', tax_status: 'completed', invoice_required: true, invoice_status: 'pending' } });
  await request<ErrorApiResponse>(markPaidContract.method, `${markPaidContract.path.replace(':id', invoiceConflict.withdrawal.id)}`, { label: 'POST mark-paid L45 invoice unverified conflict', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { manual_reference: `${runId}-invoice-conflict` } });
  const commissionConflict = await createWithdrawalFixture('a', 'mark-commission-conflict', 1520);
  await prisma.withdrawal.update({ where: { id: commissionConflict.withdrawal.id }, data: { tax_mode: 'none', tax_status: 'completed', tax_amount_cents: 0, payable_amount_cents: 1520 } });
  await prisma.commission.updateMany({ where: { withdrawal_id: commissionConflict.withdrawal.id }, data: { status: 'available' } });
  await request<ErrorApiResponse>(markPaidContract.method, `${markPaidContract.path.replace(':id', commissionConflict.withdrawal.id)}`, { label: 'POST mark-paid L45 commission conflict', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { manual_reference: `${runId}-commission-conflict` } });
  console.log('l45_mark_paid_conflict_409=true');
  const fixtureD = await createWithdrawalFixture('a', 'idempotency-history', 1300);
  const k1 = { tax_mode: 'none', taxable_amount_cents: 1300, tax_amount_cents: 0, client_request_id: `${runId}-k1`, expected_updated_at: fixtureD.withdrawal.updated_at.toISOString() };
  await request(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST tax-review L45 K1', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: k1 });
  const afterK1 = await prisma.withdrawal.findUniqueOrThrow({ where: { id: fixtureD.withdrawal.id } });
  const k2 = { tax_mode: 'withheld', taxable_amount_cents: 1300, tax_amount_cents: 100, client_request_id: `${runId}-k2`, expected_updated_at: afterK1.updated_at.toISOString() };
  await request(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST tax-review L45 K2', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: k2 });
  const replayK1 = await request<{ idempotent?: boolean }>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST tax-review L45 replay K1', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: k1 });
  const afterReplayK1 = await prisma.withdrawal.findUniqueOrThrow({ where: { id: fixtureD.withdrawal.id } });
  assert(replayK1.idempotent === true && afterReplayK1.tax_mode === 'withheld' && afterReplayK1.tax_amount_cents === 100, 'L45 replaying K1 after K2 must be idempotent and must not roll back state');
  const paidReplayAuditBefore = await prisma.adminAuditLog.count({ where: { target_id: fixtureD.withdrawal.id, action: 'withdrawal_tax_reviewed' } });
  const paidReplayEventBefore = await prisma.businessEventLog.count({ where: { withdrawal_id: fixtureD.withdrawal.id, event_type: 'withdrawal_tax_reviewed' } });
  await request(markPaidContract.method, `${markPaidContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST mark-paid L45 terminal replay fixture', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { manual_reference: `${runId}-terminal-paid` } });
  const replayK1AfterPaid = await request<{ idempotent?: boolean }>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST tax-review L45 replay K1 after paid', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: k1 });
  const afterPaidReplay = await prisma.withdrawal.findUniqueOrThrow({ where: { id: fixtureD.withdrawal.id } });
  assert(replayK1AfterPaid.idempotent === true && afterPaidReplay.status === 'paid' && afterPaidReplay.tax_amount_cents === 100 && afterPaidReplay.payable_amount_cents === 1200, 'L45 paid terminal same-key replay must be idempotent without state rollback');
  assert(await prisma.adminAuditLog.count({ where: { target_id: fixtureD.withdrawal.id, action: 'withdrawal_tax_reviewed' } }) === paidReplayAuditBefore && await prisma.businessEventLog.count({ where: { withdrawal_id: fixtureD.withdrawal.id, event_type: 'withdrawal_tax_reviewed' } }) === paidReplayEventBefore, 'L45 paid terminal same-key replay must not create audit/event');
  await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST tax-review L45 new key after paid', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { ...k2, client_request_id: `${runId}-paid-new-key`, expected_updated_at: afterPaidReplay.updated_at.toISOString() } });
  await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST tax-review L45 K1 different after paid', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { ...k1, tax_amount_cents: 1 } });

  await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureD.withdrawal.id)}`, { label: 'POST tax-review L45 stale version', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { ...k2, client_request_id: `${runId}-stale`, tax_amount_cents: 101, expected_updated_at: fixtureD.withdrawal.updated_at.toISOString() } });
  await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureA.withdrawal.id)}`, { label: 'POST /api/admin/withdrawals/:id/tax-review L45 idempotent conflict', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { ...reviewPayload, tax_amount_cents: 121 } });
  const concurrent = await Promise.allSettled([
    request(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureC.withdrawal.id)}`, { label: 'POST tax-review L45 concurrent A', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { tax_mode: 'none', taxable_amount_cents: 1200, tax_amount_cents: 0, client_request_id: `${runId}-concurrent-same`, expected_updated_at: fixtureC.withdrawal.updated_at.toISOString() } }),
    request(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureC.withdrawal.id)}`, { label: 'POST tax-review L45 concurrent B', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { tax_mode: 'none', taxable_amount_cents: 1200, tax_amount_cents: 0, client_request_id: `${runId}-concurrent-same`, expected_updated_at: fixtureC.withdrawal.updated_at.toISOString() } })
  ]);
  const concurrentFulfilled = concurrent.filter((result): result is PromiseFulfilledResult<{ applied?: boolean; idempotent?: boolean }> => result.status === 'fulfilled');
  const concurrentContract = taxReviewContract.scenarios.find((item) => item.type === 'concurrent');
  const appliedCount = concurrentFulfilled.filter((result) => result.value?.applied !== false && result.value?.idempotent !== true).length;
  const idempotentCount = concurrentFulfilled.filter((result) => result.value?.idempotent === true).length;
  assert(concurrentContract?.type === 'concurrent' && concurrentFulfilled.length === concurrentContract.fulfilled_count && appliedCount === concurrentContract.applied_count && idempotentCount === concurrentContract.idempotent_count, 'L45 same client_request_id concurrent requests must return one applied and one idempotent');
  console.log('l45_tax_review_concurrent_counts=true');
  const invalidBefore = await prisma.withdrawal.findUniqueOrThrow({ where: { id: fixtureB.withdrawal.id } });
  const invalidTaxBefore = await prisma.taxRecord.findUniqueOrThrow({ where: { source_type_source_id: { source_type: 'withdrawal', source_id: fixtureB.withdrawal.id } } });
  const invalidAuditBefore = await prisma.adminAuditLog.count({ where: { target_id: fixtureB.withdrawal.id } });
  const invalidEventBefore = await prisma.businessEventLog.count({ where: { withdrawal_id: fixtureB.withdrawal.id } });
  for (const [label, body] of [
    ['missing taxable', { tax_mode: 'none', tax_amount_cents: 0, client_request_id: `${runId}-missing-taxable`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['missing tax amount', { tax_mode: 'none', taxable_amount_cents: 2000, client_request_id: `${runId}-missing-tax-amount`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['null taxable', { tax_mode: 'none', taxable_amount_cents: null, tax_amount_cents: 0, client_request_id: `${runId}-null-taxable`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['string taxable', { tax_mode: 'none', taxable_amount_cents: '100', tax_amount_cents: 0, client_request_id: `${runId}-string-taxable`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['decimal tax amount', { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 1.5, client_request_id: `${runId}-decimal-tax-amount`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['overflow taxable', { tax_mode: 'none', taxable_amount_cents: 2147483648, tax_amount_cents: 0, client_request_id: `${runId}-overflow-taxable`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['none nonzero tax', { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 1, client_request_id: `${runId}-none-nonzero-tax`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['negative taxable', { tax_mode: 'none', taxable_amount_cents: -1, tax_amount_cents: 0, client_request_id: `${runId}-negative-taxable`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['negative tax', { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: -1, client_request_id: `${runId}-negative-tax`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['tax gt taxable', { tax_mode: 'withheld', taxable_amount_cents: 100, tax_amount_cents: 101, client_request_id: `${runId}-tax-gt-taxable`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }],
    ['payable negative', { tax_mode: 'withheld', taxable_amount_cents: 3000, tax_amount_cents: 2500, client_request_id: `${runId}-payable-negative`, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }]
  ] as const) {
    await request<ErrorApiResponse>(taxReviewContract.method, `${taxReviewContract.path.replace(':id', fixtureB.withdrawal.id)}`, { label: `POST tax-review L45 invalid ${label}`, headers: { ...financeBHeaders, 'content-type': 'application/json' }, expectedStatus: 400, body });
  }
  assert(JSON.stringify(await prisma.withdrawal.findUniqueOrThrow({ where: { id: fixtureB.withdrawal.id } })) === JSON.stringify(invalidBefore), 'L45 rejected tax review must not mutate Withdrawal');
  assert(JSON.stringify(await prisma.taxRecord.findUniqueOrThrow({ where: { source_type_source_id: { source_type: 'withdrawal', source_id: fixtureB.withdrawal.id } } })) === JSON.stringify(invalidTaxBefore), 'L45 rejected tax review must not mutate TaxRecord');
  assert(await prisma.adminAuditLog.count({ where: { target_id: fixtureB.withdrawal.id } }) === invalidAuditBefore, 'L45 rejected tax review must not create Audit');
  assert(await prisma.businessEventLog.count({ where: { withdrawal_id: fixtureB.withdrawal.id } }) === invalidEventBefore, 'L45 rejected tax review must not create Event');


  const overLimitBeforeTaxRecords = await prisma.taxRecord.count();
  for (let index = 0; index < 6; index += 1) await createWithdrawalFixture('b', `export-over-limit-${index}`, 500 + index);
  const previousExportLimit = process.env.TAX_RECORD_EXPORT_LIMIT;
  process.env.TAX_RECORD_EXPORT_LIMIT = '5';
  const overLimitResponse = await fetchOrThrow(exportContract.method, exportContract.path, { headers: financeBHeaders });
  const overLimitBytes = new Uint8Array(await overLimitResponse.arrayBuffer());
  const overLimitText = new TextDecoder('utf-8').decode(overLimitBytes);
  const overLimitDisposition = overLimitResponse.headers.get('content-disposition') ?? '';
  if (previousExportLimit === undefined) delete process.env.TAX_RECORD_EXPORT_LIMIT; else process.env.TAX_RECORD_EXPORT_LIMIT = previousExportLimit;
  record('GET /api/admin/tax-records/export.csv L45 over limit', { status: overLimitResponse.status, raw: overLimitText.slice(0, 1000) });
  assert(overLimitResponse.status === 422 && overLimitText.includes('"success":false') && overLimitBytes[0] !== 0xef && !overLimitDisposition.includes('attachment'), 'L45 export over-limit must return JSON 422 without CSV BOM or attachment');
  assert(await prisma.taxRecord.count() === overLimitBeforeTaxRecords + 6, 'L45 export over-limit HTTP request must not mutate database');
  console.log('l45_tax_export_over_limit_http_422=true');

  const csvResponse = await fetchOrThrow(exportContract.method, exportContract.path, { headers: financeAHeaders });
  const csvBytes = new Uint8Array(await csvResponse.arrayBuffer());
  const hasUtf8Bom = csvBytes.length >= 3 && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf;
  const csv = new TextDecoder('utf-8').decode(csvBytes.subarray(hasUtf8Bom ? 3 : 0));
  const disposition = csvResponse.headers.get('content-disposition') ?? '';
  record('GET /api/admin/tax-records/export.csv L45 scoped', { status: csvResponse.status, disposition, utf8_bom: hasUtf8Bom, first_bytes: Array.from(csvBytes.slice(0, 3)), raw: csv.slice(0, 1500) });
  assert(csvResponse.status === exportContract.success_status && csvResponse.ok && hasUtf8Bom, `L45 CSV must start with UTF-8 BOM bytes EF BB BF; actual=${Array.from(csvBytes.slice(0, 3)).map((value) => value.toString(16).padStart(2, '0')).join(' ')}`);
  assert(/tax-review-\d{4}-\d{2}-\d{2}\.csv/.test(disposition), 'L45 CSV filename must include date');
  assert(csv.includes('仅供内部人工核对，不构成税务申报结果。'), 'L45 CSV must include internal manual review notice');
  assert(csv.includes("'\tclient-danger") && csv.includes("'=HYPERLINK") && csv.includes("'@cmd") && csv.includes("'-1+2"), 'L45 CSV must prefix dangerous text fields with a single quote');
  assert(!csv.includes(fixtureB.withdrawal.id) && !csv.includes(communityB.name), 'L45 CSV must only include authorized scope');
  console.log('l45_tax_export_success=true');
  const csvFiltered = await requestText(exportContract.method, `${exportContract.path}?withdrawal_id=${encodeURIComponent('does-not-match-l45')}`, { label: 'GET /api/admin/tax-records/export.csv L45 filtered empty', headers: financeAHeaders });
  assert(!csvFiltered.includes(fixtureA.withdrawal.id), 'L45 CSV filters must apply');
  const executableFormula = csv.split(/\r?\n/).some((line) => line.split(',').some((cell) => /^"?[=+@]/.test(cell) || /^"?-\d/.test(cell)));
  assert(!executableFormula, 'L45 CSV must not contain executable formula-leading cells');
  const automaticEvents = await prisma.businessEventLog.count({ where: { withdrawal_id: fixtureA.withdrawal.id, event_type: { in: ['auto_tax_filed', 'auto_payout_requested', 'automatic_tax_filing', 'automatic_payout'] } } });
  assert(automaticEvents === 0, 'L45 must not create automatic tax filing or payout events');
  console.log(`l45_finance_total=${financeList.total}`);
  console.log(`l45_concurrent_fulfilled_count=${concurrentFulfilled.length}`);
  console.log(`l45_concurrent_applied_count=${appliedCount}`);
  console.log(`l45_concurrent_idempotent_count=${idempotentCount}`);
  console.log(`l45_csv_formula_safe=${!executableFormula}`);
  console.log('L45 manual tax review export runtime assertions passed.');
}

async function main() {
  await waitForApiReady();
  await ensureDockerE2eFixtures(prisma);
  const fixtureProduct = await getProductInventory(DOCKER_E2E_PRODUCT_ID);
  console.log('Docker E2E product stock reset:');
  console.log(`product_id=${DOCKER_E2E_PRODUCT_ID}`);
  console.log(`stock=${fixtureProduct.stock}`);
  assert(fixtureProduct.stock === DOCKER_E2E_INITIAL_STOCK, 'Docker E2E product stock must reset to fixed initial stock');
  const dockerAdmin = await prisma.adminUser.findUnique({ where: { id: DOCKER_E2E_ADMIN_ID } });
  assert(dockerAdmin?.status === 'active' && dockerAdmin.role === 'super_admin', 'Docker E2E admin fixture must be active super_admin');
  await request('GET', '/api/health');

  const products = await request<ListResponse<IdLike>>('GET', '/api/products?page_size=1&only_in_stock=true', { label: 'GET /api/products' });
  firstItem(products, 'GET /api/products');
  const productId = DOCKER_E2E_PRODUCT_ID;

  await request('GET', `/api/products/${productId}`, { label: 'GET /api/products/:id' });
  const productGroupBuys = await request<ListResponse<IdLike>>('GET', `/api/products/${productId}/group-buys?page_size=1`, { label: 'GET /api/products/:id/group-buys' });

  await request<ListResponse<IdLike>>('GET', '/api/communities?page_size=1', { label: 'GET /api/communities' });
  const communityId = DOCKER_E2E_COMMUNITY_ID;

  await request<ListResponse<IdLike>>('GET', '/api/pickup-stores?page_size=1', { label: 'GET /api/pickup-stores' });
  const pickupStoreId = DOCKER_E2E_PICKUP_STORE_ID;
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
  const deliveryClientRequestId = `docker-e2e-delivery-${Date.now()}`;
  const deliveryQuantity = 1;
  const deliveryStockBefore = await getProductInventory(productId);
  const deliveryOrder = await requestOrderWithInventoryContext<any>({ product_id: productId, user_openid: `${openid}-delivery`, client_request_id: deliveryClientRequestId, quantity: deliveryQuantity, pickup_type: 'delivery', pickup_store_id: pickupStoreId, community_id: communityId, receiver_name: 'Docker E2E 配送', receiver_phone: receiverPhone, receiver_address: '测试配送地址', delivery_time_window_code: deliveryWindowCode }, 'POST /api/orders/normal delivery with delivery_time_window_code');
  assert(deliveryOrder.pickup_type === 'delivery', 'delivery order response must include pickup_type=delivery');
  assert(deliveryOrder.receiver_phone_masked && !JSON.stringify(deliveryOrder).includes(receiverPhone), 'delivery order response must include receiver_phone_masked and hide raw phone');
  const expectedProductAmount = deliveryOrder.product_amount_cents ?? deliveryOrder.total_amount_cents;
  assert(typeof expectedProductAmount === 'number' && expectedProductAmount > 0, 'delivery order must include product_amount_cents');
  assert(typeof deliveryOrder.delivery_fee_cents === 'number', 'delivery order must include delivery_fee_cents');
  assert(deliveryOrder.pay_amount_cents === expectedProductAmount + deliveryOrder.delivery_fee_cents, 'delivery pay_amount_cents must include delivery_fee_cents');
  const expectedDeliveryDeductQuantity = deliveryQuantity * deliveryStockBefore.stock_deduct_quantity;
  const paidDelivery = await request<any>('POST', '/api/payments/mock', { label: 'POST /api/payments/mock delivery amount', body: { order_id: deliveryOrder.id } });
  assert(paidDelivery.pay_amount_cents === deliveryOrder.pay_amount_cents, 'mock payment amount must equal order pay_amount_cents');
  const deliveryStockAfterPayment = await getProductInventory(productId);
  assert(deliveryStockAfterPayment.stock === deliveryStockBefore.stock - expectedDeliveryDeductQuantity, 'Docker E2E paid delivery order must deduct expected inventory');
  await request<any>('POST', '/api/payments/mock', { label: 'POST /api/payments/mock delivery duplicate', body: { order_id: deliveryOrder.id } });
  const deliveryStockAfterDuplicatePayment = await getProductInventory(productId);
  assert(deliveryStockAfterDuplicatePayment.stock === deliveryStockAfterPayment.stock, 'Docker E2E duplicate payment must not deduct inventory again');
  const deliveryUserHeaders = { 'x-openid': `${openid}-delivery` };
  const deliveryDetail = await request<any>('GET', `/api/me/orders/${deliveryOrder.id}`, { label: 'GET /api/me/orders/:id delivery detail', headers: deliveryUserHeaders });
  assert(deliveryDetail.product_amount_cents === expectedProductAmount && deliveryDetail.delivery_fee_cents === deliveryOrder.delivery_fee_cents && deliveryDetail.pay_amount_cents === deliveryOrder.pay_amount_cents, 'user order detail must expose L38 amount fields');
  assert(deliveryDetail.delivery_time_window_text || deliveryDetail.delivery?.delivery_time_window_text, 'user order detail must expose delivery_time_window_text');
  const adminDelivery = await request<any>('GET', '/api/admin/delivery/orders?page_size=50&pickup_type=delivery', withAdmin({ label: 'GET /api/admin/delivery/orders' }));
  assert(JSON.stringify(adminDelivery).includes('delivery_fee_cents') && JSON.stringify(adminDelivery).includes('pay_amount_cents'), 'Admin delivery list must expose delivery fee and pay amount');
  const financeOverview = await request<any>('GET', '/api/admin/finance/reconciliation/overview', withAdmin({ label: 'GET /api/admin/finance/reconciliation/overview' }));
  assert(typeof financeOverview.total_delivery_fee_cents === 'number', 'finance reconciliation summary must include total_delivery_fee_cents');
  const deliveryProductRefundAmount = deliveryOrder.product_amount_cents ?? deliveryOrder.total_amount_cents;
  await request<any>('POST', '/api/refunds/mock', { label: 'POST /api/refunds/mock delivery full refund', body: { order_id: deliveryOrder.id, refund_amount_cents: deliveryOrder.pay_amount_cents, product_refund_amount_cents: deliveryProductRefundAmount, delivery_refund_amount_cents: deliveryOrder.delivery_fee_cents ?? 0, reason: 'Docker E2E L41 full refund restore', client_refund_id: `docker-e2e-delivery-full-refund-${Date.now()}` } });
  const deliveryStockAfterRefund = await getProductInventory(productId);
  console.log('Docker E2E inventory:');
  console.log(`before=${deliveryStockBefore.stock}`);
  console.log(`after_payment=${deliveryStockAfterPayment.stock}`);
  console.log(`after_duplicate_payment=${deliveryStockAfterDuplicatePayment.stock}`);
  console.log(`after_refund=${deliveryStockAfterRefund.stock}`);
  assert(deliveryStockAfterRefund.stock === deliveryStockBefore.stock, 'Docker E2E full refund must restore paid delivery inventory');

  // L41: insufficient stock uses isolated low-stock fixture and must not affect main fixture product.
  const insufficientClientRequestId = `docker-e2e-insufficient-${Date.now()}`;
  const insufficientOrder = await request<any>('POST', '/api/orders/normal', { label: 'POST /api/orders/normal L41 insufficient fixture', body: { product_id: DOCKER_E2E_INSUFFICIENT_STOCK_PRODUCT_ID, user_openid: `${openid}-insufficient`, client_request_id: insufficientClientRequestId, quantity: 1, pickup_store_id: pickupStoreId, community_id: communityId, receiver_name: 'Docker E2E 低库存', receiver_phone: receiverPhone } });
  await request<any>('POST', '/api/payments/mock', { label: 'POST /api/payments/mock L41 insufficient fixture', expectedStatus: 400, body: { order_id: insufficientOrder.id } });
  const insufficientProduct = await getProductInventory(DOCKER_E2E_INSUFFICIENT_STOCK_PRODUCT_ID);
  assert(insufficientProduct.stock === 2, 'Docker E2E insufficient stock fixture must remain unchanged after failed payment');

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
  const noAdminReview = await request<ErrorApiResponse>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, {
    label: 'POST /api/admin/after-sales/:id/review L40 no admin identity',
    expectedStatus: 401,
    headers: { 'content-type': 'application/json' },
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'no admin should fail' }
  });
  assert(noAdminReview.message.includes('ADMIN_UNAUTHORIZED: Admin identity required'), 'No Admin identity must return HTTP 401');

  const roleWithoutUserReview = await request<ErrorApiResponse>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, {
    label: 'POST /api/admin/after-sales/:id/review L40 role without user id',
    expectedStatus: 401,
    headers: { 'content-type': 'application/json', 'x-admin-role': 'super_admin' },
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'role without user id should fail' }
  });
  assert(roleWithoutUserReview.message.includes('ADMIN_UNAUTHORIZED: Admin identity required'), 'Admin role without user id must return HTTP 401');

  const missingAdminReview = await request<ErrorApiResponse>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, {
    label: 'POST /api/admin/after-sales/:id/review L40 missing admin fixture',
    expectedStatus: 401,
    headers: { 'content-type': 'application/json', 'x-admin-role': 'super_admin', 'x-admin-user-id': 'docker-e2e-missing-admin' },
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'missing admin should fail' }
  });
  assert(missingAdminReview.message.includes('ADMIN_UNAUTHORIZED: Active AdminUser required'), 'Missing AdminUser must return HTTP 401');

  const inactiveAdminReview = await request<ErrorApiResponse>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, {
    label: 'POST /api/admin/after-sales/:id/review L40 inactive admin',
    expectedStatus: 401,
    headers: { 'content-type': 'application/json', 'x-admin-role': 'super_admin', 'x-admin-user-id': DOCKER_E2E_INACTIVE_ADMIN_ID },
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'inactive admin should fail' }
  });
  assert(inactiveAdminReview.message.includes('ADMIN_UNAUTHORIZED: Active AdminUser required'), 'Inactive AdminUser must return HTTP 401');

  const operatorReview = await request<ErrorApiResponse>('POST', `/api/admin/after-sales/${l39AfterSaleId}/review`, {
    label: 'POST /api/admin/after-sales/:id/review L40 insufficient permission',
    expectedStatus: 403,
    headers: { 'content-type': 'application/json', 'x-admin-role': 'operator', 'x-admin-user-id': DOCKER_E2E_OPERATOR_ADMIN_ID },
    body: { status: 'approved', resolution_type: 'partial_refund', responsibility: 'platform', approved_refund_cents: 300, approved_product_refund_cents: 100, approved_delivery_refund_cents: 200, admin_note: 'operator should fail' }
  });
  assert(operatorReview.message.includes('ADMIN_FORBIDDEN: Permission denied'), 'Active AdminUser without permission must return HTTP 403');

  await ensureDockerE2eFixtures(prisma);
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
  const crossScopeOrder = await request<ErrorApiResponse>('GET', `/api/admin/orders/${l39DeliveryOrder.id}`, { ...withAdmin({ label: 'GET /api/admin/orders/:id L40 cross pickup scope', expectedStatus: 403 }), headers: { 'x-admin-role': 'store_manager', 'x-admin-user-id': DOCKER_E2E_STORE_MANAGER_ADMIN_ID, 'x-admin-pickup-store-id': 'docker-e2e-other-store' } });
  assert(crossScopeOrder.message.includes('ADMIN_SCOPE_FORBIDDEN: Data scope denied'), 'Active scoped AdminUser must receive HTTP 403 for order scope mismatch');
  const crossScopeAfterSale = await request<ErrorApiResponse>('GET', `/api/admin/after-sales/${l39AfterSaleId}`, { ...withAdmin({ label: 'GET /api/admin/after-sales/:id L40 cross pickup scope', expectedStatus: 403 }), headers: { 'x-admin-role': 'store_manager', 'x-admin-user-id': DOCKER_E2E_STORE_MANAGER_ADMIN_ID, 'x-admin-pickup-store-id': 'docker-e2e-other-store' } });
  assert(crossScopeAfterSale.message.includes('ADMIN_SCOPE_FORBIDDEN: Data scope denied'), 'Active scoped AdminUser must receive HTTP 403 for after-sale scope mismatch');
  await ensureDockerE2eFixtures(prisma);
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


  const l42Admin = await prisma.adminUser.findUnique({ where: { id: DOCKER_E2E_ADMIN_ID } });
  assert(l42Admin?.status === 'active', 'Docker E2E active admin fixture missing');
  const l42Prefix = `docker-l42-${Date.now()}`;
  const l42Product = await prisma.product.findUniqueOrThrow({ where: { id: DOCKER_E2E_PRODUCT_ID } });
  const l42Leader = await prisma.user.upsert({ where: { openid: `${l42Prefix}-leader` }, update: {}, create: { openid: `${l42Prefix}-leader`, nickname: 'Docker L42 leader', role: 'leader', status: 'active' } });
  const l42User = await prisma.user.upsert({ where: { openid: `${l42Prefix}-user` }, update: {}, create: { openid: `${l42Prefix}-user`, nickname: 'Docker L42 user', role: 'customer', status: 'active' } });
  const l42GroupBuy = await prisma.groupBuy.create({ data: { product_id: DOCKER_E2E_PRODUCT_ID, leader_user_id: l42Leader.id, community_id: DOCKER_E2E_COMMUNITY_ID, min_people: 3, min_quantity: 3, price_cents: l42Product.price_cents, start_time: new Date(Date.now() - 7200_000), end_time: new Date(Date.now() - 3600_000), pickup_time: new Date(Date.now() + 86400_000), status: 'pending' } });
  const l42PaidOrder = await prisma.order.create({ data: { order_no: `${l42Prefix}-paid`, user_id: l42User.id, group_buy_id: l42GroupBuy.id, product_id: DOCKER_E2E_PRODUCT_ID, leader_user_id: l42Leader.id, community_id: DOCKER_E2E_COMMUNITY_ID, total_amount_cents: l42Product.price_cents, product_amount_cents: l42Product.price_cents, pay_amount_cents: l42Product.price_cents, quantity: 1, pay_status: 'paid', order_status: 'paid', refund_status: 'none', paid_at: new Date(), receiver_name: 'Docker L42', receiver_phone: '13800000000' } });
  const l42UnpaidOrder = await prisma.order.create({ data: { order_no: `${l42Prefix}-unpaid`, user_id: l42User.id, group_buy_id: l42GroupBuy.id, product_id: DOCKER_E2E_PRODUCT_ID, leader_user_id: l42Leader.id, community_id: DOCKER_E2E_COMMUNITY_ID, total_amount_cents: l42Product.price_cents, product_amount_cents: l42Product.price_cents, pay_amount_cents: l42Product.price_cents, quantity: 1, pay_status: 'unpaid', order_status: 'unpaid', refund_status: 'none', receiver_name: 'Docker L42', receiver_phone: '13800000000' } });
  const l42StockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: DOCKER_E2E_PRODUCT_ID } })).stock;
  await prisma.product.update({ where: { id: DOCKER_E2E_PRODUCT_ID }, data: { stock: { decrement: 1 } } });
  await prisma.stockLedger.create({ data: { product_id: DOCKER_E2E_PRODUCT_ID, source_type: 'order_payment', source_id: l42PaidOrder.id, idempotency_key: `docker-l42-paid-deduct:${l42PaidOrder.id}`, event_type: 'order_paid_deduct', quantity_delta: -1, order_id: l42PaidOrder.id, direction: 'out', quantity: 1, stock_before: l42StockBefore, stock_after: l42StockBefore - 1, operator_type: 'system', remark: 'Docker L42 paid deduction fixture' } });

  const scopePrefix = `${l42Prefix}-scope`;
  const scopeGroupBuy = await prisma.groupBuy.create({ data: { product_id: DOCKER_E2E_PRODUCT_ID, leader_user_id: l42Leader.id, community_id: DOCKER_E2E_COMMUNITY_ID, min_people: 3, min_quantity: 3, price_cents: l42Product.price_cents, start_time: new Date(Date.now() - 7200_000), end_time: new Date(Date.now() - 3600_000), pickup_time: new Date(Date.now() + 86400_000), status: 'pending' } });
  const scopePaidOrder = await prisma.order.create({ data: { order_no: `${scopePrefix}-paid`, user_id: l42User.id, group_buy_id: scopeGroupBuy.id, product_id: DOCKER_E2E_PRODUCT_ID, leader_user_id: l42Leader.id, community_id: DOCKER_E2E_COMMUNITY_ID, total_amount_cents: l42Product.price_cents, product_amount_cents: l42Product.price_cents, pay_amount_cents: l42Product.price_cents, quantity: 1, pay_status: 'paid', order_status: 'paid', refund_status: 'none', paid_at: new Date(), receiver_name: 'Docker L42 Scope', receiver_phone: '13800000000' } });
  const scopeUnpaidOrder = await prisma.order.create({ data: { order_no: `${scopePrefix}-unpaid`, user_id: l42User.id, group_buy_id: scopeGroupBuy.id, product_id: DOCKER_E2E_PRODUCT_ID, leader_user_id: l42Leader.id, community_id: DOCKER_E2E_COMMUNITY_ID, total_amount_cents: l42Product.price_cents, product_amount_cents: l42Product.price_cents, pay_amount_cents: l42Product.price_cents, quantity: 1, pay_status: 'unpaid', order_status: 'unpaid', refund_status: 'none', receiver_name: 'Docker L42 Scope', receiver_phone: '13800000000' } });
  const scopeRefund = await prisma.refund.create({ data: { order_id: scopePaidOrder.id, out_refund_no: `${scopePrefix}-refund`, client_refund_id: `${scopePrefix}-refund`, refund_amount_cents: scopePaidOrder.pay_amount_cents, product_refund_amount_cents: scopePaidOrder.product_amount_cents ?? scopePaidOrder.pay_amount_cents, delivery_refund_amount_cents: 0, reason: 'Docker E2E L42 scope denied refund fixture', status: 'success', processed_at: new Date() } });
  const scopeAuditBefore = await prisma.adminAuditLog.count({ where: { admin_user_id: DOCKER_E2E_STORE_MANAGER_ADMIN_ID } });
  const scopeFinanceAuditBefore = await prisma.adminAuditLog.count({ where: { admin_user_id: DOCKER_E2E_FINANCE_ADMIN_ID } });
  const scopeStockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: DOCKER_E2E_PRODUCT_ID } })).stock;
  const storeManagerWrongScopeHeaders = { 'content-type': 'application/json', 'x-admin-role': 'store_manager', 'x-admin-user-id': DOCKER_E2E_STORE_MANAGER_ADMIN_ID, 'x-admin-community-id': 'docker-e2e-other-community' };
  const financeWrongScopeHeaders = { 'content-type': 'application/json', 'x-admin-role': 'finance', 'x-admin-user-id': DOCKER_E2E_FINANCE_ADMIN_ID, 'x-admin-community-id': 'docker-e2e-other-community' };
  const l42ScopeSummary = await request<ErrorApiResponse>('GET', `/api/admin/group-buys/${scopeGroupBuy.id}/closure-summary`, { label: 'GET /api/admin/group-buys/:id/closure-summary L42 cross community scope', expectedStatus: 403, headers: storeManagerWrongScopeHeaders });
  const l42ScopeManualRefundOrders = await request<ErrorApiResponse>('GET', `/api/admin/group-buys/${scopeGroupBuy.id}/manual-refund-orders`, { label: 'GET /api/admin/group-buys/:id/manual-refund-orders L42 cross community scope', expectedStatus: 403, headers: financeWrongScopeHeaders });
  const l42ScopeMarkFailed = await request<ErrorApiResponse>('POST', `/api/admin/group-buys/${scopeGroupBuy.id}/mark-failed`, { label: 'POST /api/admin/group-buys/:id/mark-failed L42 cross community scope', expectedStatus: 403, headers: storeManagerWrongScopeHeaders, body: { reason: 'scope denied' } });
  const l42ScopeCloseUnpaid = await request<ErrorApiResponse>('POST', `/api/admin/group-buys/${scopeGroupBuy.id}/close-unpaid-orders`, { label: 'POST /api/admin/group-buys/:id/close-unpaid-orders L42 cross community scope', expectedStatus: 403, headers: storeManagerWrongScopeHeaders, body: { admin_note: 'scope denied' } });
  const l42ScopeConfirmRefund = await request<ErrorApiResponse>('POST', `/api/admin/group-buys/${scopeGroupBuy.id}/orders/${scopePaidOrder.id}/confirm-refund`, { label: 'POST /api/admin/group-buys/:groupBuyId/orders/:orderId/confirm-refund L42 cross community scope', expectedStatus: 403, headers: financeWrongScopeHeaders, body: { refund_id: scopeRefund.id, admin_note: 'scope denied' } });
  const l42ScopeFinalClose = await request<ErrorApiResponse>('POST', `/api/admin/group-buys/${scopeGroupBuy.id}/close`, { label: 'POST /api/admin/group-buys/:id/close L42 cross community scope', expectedStatus: 403, headers: storeManagerWrongScopeHeaders, body: { admin_note: 'scope denied' } });
  for (const item of [l42ScopeSummary, l42ScopeManualRefundOrders, l42ScopeMarkFailed, l42ScopeCloseUnpaid, l42ScopeConfirmRefund, l42ScopeFinalClose]) {
    assert(item.message.includes('ADMIN_SCOPE_FORBIDDEN: Data scope denied'), 'L42 cross-scope admin APIs must return ADMIN_SCOPE_FORBIDDEN');
  }
  assert((await prisma.groupBuy.findUniqueOrThrow({ where: { id: scopeGroupBuy.id } })).status === 'pending', 'L42 cross-scope calls must not change group buy status');
  assert((await prisma.order.findUniqueOrThrow({ where: { id: scopeUnpaidOrder.id } })).order_status === 'unpaid', 'L42 cross-scope close-unpaid must not close orders');
  assert((await prisma.refund.findUniqueOrThrow({ where: { id: scopeRefund.id } })).stock_restored === false, 'L42 cross-scope confirm-refund must not mark stock restored');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: DOCKER_E2E_PRODUCT_ID } })).stock === scopeStockBefore, 'L42 cross-scope calls must not change inventory');
  assert(await prisma.adminAuditLog.count({ where: { admin_user_id: DOCKER_E2E_STORE_MANAGER_ADMIN_ID } }) === scopeAuditBefore, 'L42 cross-scope store manager calls must not write audit logs');
  assert(await prisma.adminAuditLog.count({ where: { admin_user_id: DOCKER_E2E_FINANCE_ADMIN_ID } }) === scopeFinanceAuditBefore, 'L42 cross-scope finance calls must not write audit logs');

  const statusBefore = l42GroupBuy.status;
  const failedResult = await request<{ status: string }>('POST', `/api/admin/group-buys/${l42GroupBuy.id}/mark-failed`, withAdminJson({ label: 'POST /api/admin/group-buys/:id/mark-failed L42', body: { reason: 'Docker E2E L42 未达标人工失败' } }));
  assertSafeL42Response(failedResult, 'L42 mark-failed response');
  const stockAfterFailed = (await prisma.product.findUniqueOrThrow({ where: { id: DOCKER_E2E_PRODUCT_ID } })).stock;
  assert(failedResult.status === 'failed', 'L42 mark failed must return failed');
  assert(stockAfterFailed === l42StockBefore - 1, 'L42 mark failed must not restore inventory');
  assert(await prisma.refund.count({ where: { order_id: l42PaidOrder.id } }) === 0, 'L42 mark failed must not auto refund');
  const closeUnpaidResult = await request<{ closed_count: number }>('POST', `/api/admin/group-buys/${l42GroupBuy.id}/close-unpaid-orders`, withAdminJson({ label: 'POST /api/admin/group-buys/:id/close-unpaid-orders L42', body: { admin_note: 'Docker E2E L42 close unpaid' } }));
  assertSafeL42Response(closeUnpaidResult, 'L42 close-unpaid response');
  const l42UnpaidAfter = await prisma.order.findUniqueOrThrow({ where: { id: l42UnpaidOrder.id } });
  assert(closeUnpaidResult.closed_count === 1 && l42UnpaidAfter.pay_status === 'unpaid' && l42UnpaidAfter.order_status === 'closed', 'L42 unpaid order closure must keep pay_status unpaid');
  const pendingRefundList = await request<{ summary: { pending_refund_orders: number }; items: Array<{ order_id: string; latest_refund_id: string | null }> }>('GET', `/api/admin/group-buys/${l42GroupBuy.id}/manual-refund-orders`, withAdmin({ label: 'GET /api/admin/group-buys/:id/manual-refund-orders L42' }));
  assertSafeL42Response(pendingRefundList, 'L42 manual-refund-orders response');
  assert(pendingRefundList.summary.pending_refund_orders === 1, 'L42 paid order must be pending manual refund');
  const blockedClose = await request<{ applied: boolean; blockers?: Array<{ type: string; count: number }> }>('POST', `/api/admin/group-buys/${l42GroupBuy.id}/close`, withAdminJson({ label: 'POST /api/admin/group-buys/:id/close L42 blocked', body: { admin_note: 'should block' } }));
  assertSafeL42Response(blockedClose, 'L42 blocked close response');
  assert(!blockedClose.applied, 'L42 final close must block before refund success');
  const l42Refund = await prisma.refund.create({ data: { order_id: l42PaidOrder.id, out_refund_no: `${l42Prefix}-success-refund`, client_refund_id: `${l42Prefix}-success-refund`, refund_amount_cents: l42PaidOrder.pay_amount_cents, product_refund_amount_cents: l42PaidOrder.product_amount_cents ?? l42PaidOrder.pay_amount_cents, delivery_refund_amount_cents: 0, reason: 'Docker E2E L42 success refund fixture', status: 'success', processed_at: new Date() } });
  const confirmRefundResponse = await request<{ applied: boolean; idempotent: boolean; order: { order_id: string; receiver_phone_masked?: string | null }; refund: { refund_id: string }; inventory: unknown }>('POST', `/api/admin/group-buys/${l42GroupBuy.id}/orders/${l42PaidOrder.id}/confirm-refund`, withAdminJson({ label: 'POST /api/admin/group-buys/:groupBuyId/orders/:orderId/confirm-refund L42', body: { refund_id: l42Refund.id, admin_note: 'Docker E2E L42 confirm success refund' } }));
  const repeatConfirmRefundResponse = await request<{ applied: boolean; idempotent: boolean; order: { order_id: string; receiver_phone_masked?: string | null }; refund: { refund_id: string }; inventory: unknown }>('POST', `/api/admin/group-buys/${l42GroupBuy.id}/orders/${l42PaidOrder.id}/confirm-refund`, withAdminJson({ label: 'POST /api/admin/group-buys/:groupBuyId/orders/:orderId/confirm-refund L42 repeat', body: { refund_id: l42Refund.id, admin_note: 'repeat' } }));
  assertSafeL42Response(confirmRefundResponse, 'L42 confirm-refund response');
  assertSafeL42Response(repeatConfirmRefundResponse, 'L42 repeat confirm-refund response');
  assert(confirmRefundResponse.order.order_id === l42PaidOrder.id && confirmRefundResponse.refund.refund_id === l42Refund.id && confirmRefundResponse.inventory, 'L42 confirm-refund response must include safe order/refund/inventory');
  assert(typeof confirmRefundResponse.order.receiver_phone_masked === 'string' && confirmRefundResponse.order.receiver_phone_masked.includes('****'), 'L42 confirm-refund response must include masked phone');
  assert(repeatConfirmRefundResponse.idempotent === true && repeatConfirmRefundResponse.order.order_id === l42PaidOrder.id && repeatConfirmRefundResponse.refund.refund_id === l42Refund.id && repeatConfirmRefundResponse.inventory, 'L42 repeat confirm-refund response must be idempotent and safe');
  const stockAfterRefund = (await prisma.product.findUniqueOrThrow({ where: { id: DOCKER_E2E_PRODUCT_ID } })).stock;
  assert(stockAfterRefund === l42StockBefore, 'L42 refund confirmation must restore inventory once');
  const finalClose = await request<{ status: string }>('POST', `/api/admin/group-buys/${l42GroupBuy.id}/close`, withAdminJson({ label: 'POST /api/admin/group-buys/:id/close L42 final', body: { admin_note: 'Docker E2E L42 final close' } }));
  assertSafeL42Response(finalClose, 'L42 final close response');
  const repeatFinalClose = await request<{ status: string; idempotent: boolean }>('POST', `/api/admin/group-buys/${l42GroupBuy.id}/close`, withAdminJson({ label: 'POST /api/admin/group-buys/:id/close L42 repeat final', body: { admin_note: 'repeat' } }));
  assertSafeL42Response(repeatFinalClose, 'L42 repeat final close response');
  assert(repeatFinalClose.idempotent === true, 'L42 repeat final close must be idempotent');
  console.log('Group buy closure:');
  console.log(`group_buy_id=${l42GroupBuy.id}`);
  console.log(`status_before=${statusBefore}`);
  console.log(`status_after_failed=${failedResult.status}`);
  console.log(`unpaid_closed_count=${closeUnpaidResult.closed_count}`);
  console.log(`pending_refund_count=${pendingRefundList.summary.pending_refund_orders}`);
  console.log('refunded_count=1');
  console.log(`inventory_before=${l42StockBefore}`);
  console.log(`inventory_after_refund=${stockAfterRefund}`);
  console.log(`final_status=${finalClose.status}`);

  await runL45TaxReviewScenario();
  await runL44WithdrawalScenario();
  await runL43RewardLedgerScenario();
  assertNoRiskFindings();
  console.log('Docker API E2E verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});

// L41/L42 Docker API E2E scenarios are registered for deterministic container verification:
// Scenario A normal paid order deducts stock 20 -> 14 and duplicate payment remains 14.
// Scenario B insufficient stock keeps order unpaid and writes no deduct ledger.
// Scenario C full product refund restores inventory once and duplicate handling is idempotent.
// Scenario D partial amount refund without restore_quantity does not change stock.
// Scenario E delivery fee refund does not change stock.
// Scenario F group failed marker itself does not restore stock; manual refund success restores once.
// Scenario G L42 failed group buy manual closure uses admin APIs, manual refund success confirmation, final close idempotency.
