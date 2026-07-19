import {
  CommissionStatus,
  GroupBuyStatus,
  OrderStatus,
  PayStatus,
  PickupType,
  PrismaClient,
  WithdrawalStatus,
} from '@prisma/client';
import { safeRecordBusinessEvent } from '../apps/api/src/services/logging-service.js';
import {
  L48_PROHIBITED_RESPONSE_KEYS,
  L48_RUNTIME_MARKERS,
  findProhibitedResponsePaths,
} from './l48-security-privacy-contract.ts';

type ApiEnvelope<T = unknown> = {
  success: boolean;
  data: T;
  message: string;
};

type CapturedResponse<T = unknown> = {
  status: number;
  body: ApiEnvelope<T>;
  text: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number;
};

const markers = {
  queryOnlyIdentity: 'l48_query_only_identity_rejected=true',
  headerIdentityWins: 'l48_header_identity_wins=true',
  inactiveForbidden: 'l48_inactive_user_forbidden=true',
  nonLeaderForbidden: 'l48_non_leader_forbidden=true',
  rewardOwnerScope: 'l48_reward_owner_scope_verified=true',
  withdrawalOwnerScope: 'l48_withdrawal_owner_scope_verified=true',
  responsePrivacy: 'l48_response_privacy_verified=true',
  httpLogPrivacy: 'l48_http_log_privacy_verified=true',
  businessLogPrivacy: 'l48_business_log_privacy_verified=true',
  unknownErrorSanitized: 'l48_unknown_error_sanitized=true',
} as const;

const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://127.0.0.1:13080').replace(
  /\/$/,
  '',
);
const RUN_TOKEN = process.env.L48_RUN_TOKEN ?? `${Date.now()}`;
const HTTP_LOG_MARKER =
  process.env.L48_HTTP_LOG_MARKER ?? `l48-http-log-${RUN_TOKEN}-secret`;
const HTTP_LOG_PHONE = process.env.L48_HTTP_LOG_PHONE ?? '13948000000';
const prefix = `l48-${RUN_TOKEN}`;
const prisma = new PrismaClient();
const capturedBodies: unknown[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function emitMarker(marker: (typeof markers)[keyof typeof markers]): void {
  assert(
    new Set<string>(L48_RUNTIME_MARKERS).has(marker),
    `Unregistered L48 runtime marker: ${marker}`,
  );
  console.log(marker);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiReady(maxAttempts = 80): Promise<void> {
  let lastStatus = 'not attempted';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : 'UnknownError';
    }
    await sleep(250);
  }
  throw new Error(`L48 isolated API did not become ready: ${lastStatus}`);
}

async function requestJson<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<CapturedResponse<T>> {
  const headers: Record<string, string> = {
    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(
      `L48 ${options.method ?? 'GET'} ${path} returned non-JSON HTTP ${response.status}`,
    );
  }

  const expectedStatus = options.expectedStatus ?? 200;
  assert(
    response.status === expectedStatus,
    `L48 ${options.method ?? 'GET'} ${path} expected HTTP ${expectedStatus}, received ${response.status}: ${body.message}`,
  );
  assert(
    body.success === (expectedStatus >= 200 && expectedStatus < 300),
    `L48 ${path} success flag does not match HTTP ${expectedStatus}`,
  );

  capturedBodies.push(body);
  return { status: response.status, body, text };
}

async function cleanup(): Promise<void> {
  await prisma.withdrawalCommission.deleteMany({
    where: {
      OR: [
        { withdrawal_id: { startsWith: prefix } },
        { commission_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.rewardLedger.deleteMany({
    where: {
      OR: [
        { leader_user_id: { startsWith: prefix } },
        { commission_id: { startsWith: prefix } },
        { order_id: { startsWith: prefix } },
        { withdrawal_id: { startsWith: prefix } },
        { idempotency_key: { contains: prefix } },
      ],
    },
  });
  await prisma.consumerCreditLedger.deleteMany({
    where: {
      OR: [
        { user_id: { startsWith: prefix } },
        { source_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.rewardConversion.deleteMany({
    where: {
      OR: [
        { leader_user_id: { startsWith: prefix } },
        { commission_id: { startsWith: prefix } },
        { client_request_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.taxRecord.deleteMany({
    where: {
      OR: [
        { leader_user_id: { startsWith: prefix } },
        { source_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.businessEventLog.deleteMany({
    where: {
      OR: [
        { order_id: { startsWith: prefix } },
        { group_buy_id: { startsWith: prefix } },
        { commission_id: { startsWith: prefix } },
        { withdrawal_id: { startsWith: prefix } },
        { leader_user_id: { startsWith: prefix } },
        { user_id: { startsWith: prefix } },
        { idempotency_key: { startsWith: prefix } },
      ],
    },
  });
  await prisma.orderTimelineLog.deleteMany({
    where: { order_id: { startsWith: prefix } },
  });
  await prisma.opsAlertLog.deleteMany({
    where: {
      OR: [
        { order_id: { startsWith: prefix } },
        { group_buy_id: { startsWith: prefix } },
        { commission_id: { startsWith: prefix } },
        { withdrawal_id: { startsWith: prefix } },
        { leader_user_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.afterSaleCase.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { order_id: { startsWith: prefix } },
        { user_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.withdrawal.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { leader_user_id: { startsWith: prefix } },
        { client_request_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.commission.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { leader_user_id: { startsWith: prefix } },
        { order_id: { startsWith: prefix } },
        { group_buy_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.order.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { order_no: { startsWith: prefix } },
        { user_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.groupBuy.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { leader_user_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.product.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { name: { startsWith: prefix } },
      ],
    },
  });
  await prisma.category.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { name: { startsWith: prefix } },
      ],
    },
  });
  await prisma.community.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { name: { startsWith: prefix } },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { openid: { startsWith: prefix } },
      ],
    },
  });
}

async function createFixtures() {
  const now = new Date('2026-07-19T00:00:00.000Z');
  const customerA = await prisma.user.create({
    data: {
      id: `${prefix}-customer-a`,
      openid: `${prefix}-customer-a-openid`,
      unionid: `${prefix}-customer-a-unionid-secret`,
      nickname: 'L48 Customer A',
      phone: '13948000001',
      role: 'customer',
      status: 'active',
    },
  });
  const customerB = await prisma.user.create({
    data: {
      id: `${prefix}-customer-b`,
      openid: `${prefix}-customer-b-openid`,
      nickname: 'L48 Customer B',
      phone: '13948000002',
      role: 'customer',
      status: 'active',
    },
  });
  const inactive = await prisma.user.create({
    data: {
      id: `${prefix}-inactive`,
      openid: `${prefix}-inactive-openid`,
      nickname: 'L48 Inactive',
      role: 'customer',
      status: 'inactive',
    },
  });
  const leaderA = await prisma.user.create({
    data: {
      id: `${prefix}-leader-a`,
      openid: `${prefix}-leader-a-openid`,
      nickname: 'L48 Leader A',
      phone: '13948000003',
      role: 'leader',
      status: 'active',
    },
  });
  const leaderB = await prisma.user.create({
    data: {
      id: `${prefix}-leader-b`,
      openid: `${prefix}-leader-b-openid`,
      nickname: 'L48 Leader B',
      phone: '13948000004',
      role: 'leader',
      status: 'active',
    },
  });

  const category = await prisma.category.create({
    data: {
      id: `${prefix}-category`,
      name: `${prefix}-category`,
      sort_order: 48,
      status: 'active',
    },
  });
  const product = await prisma.product.create({
    data: {
      id: `${prefix}-product`,
      name: `${prefix}-product`,
      category_id: category.id,
      price_cents: 1800,
      cost_price_cents: 900,
      stock: 100,
      unit: '份',
      stock_unit: 'piece',
      sale_unit: '份',
      is_group_enabled: true,
      commission_type: 'fixed',
      commission_value: 700,
      status: 'active',
    },
  });
  const community = await prisma.community.create({
    data: {
      id: `${prefix}-community`,
      name: `${prefix}-community`,
      address: `${prefix}-community-address`,
    },
  });

  const groupA = await prisma.groupBuy.create({
    data: {
      id: `${prefix}-group-a`,
      product_id: product.id,
      leader_user_id: leaderA.id,
      community_id: community.id,
      min_people: 1,
      min_quantity: 1,
      current_people: 2,
      current_quantity: 2,
      price_cents: 1800,
      start_time: now,
      end_time: new Date(now.getTime() + 86_400_000),
      pickup_time: new Date(now.getTime() + 172_800_000),
      status: GroupBuyStatus.success,
    },
  });
  const groupB = await prisma.groupBuy.create({
    data: {
      id: `${prefix}-group-b`,
      product_id: product.id,
      leader_user_id: leaderB.id,
      community_id: community.id,
      min_people: 1,
      min_quantity: 1,
      current_people: 1,
      current_quantity: 1,
      price_cents: 1800,
      start_time: now,
      end_time: new Date(now.getTime() + 86_400_000),
      pickup_time: new Date(now.getTime() + 172_800_000),
      status: GroupBuyStatus.success,
    },
  });

  const normalOrderA = await prisma.order.create({
    data: {
      id: `${prefix}-order-normal-a`,
      order_no: `${prefix}-order-no-normal-a`,
      user_id: customerA.id,
      product_id: product.id,
      total_amount_cents: 1800,
      product_amount_cents: 1600,
      delivery_fee_cents: 200,
      pay_amount_cents: 1800,
      quantity: 1,
      pay_status: PayStatus.paid,
      order_status: OrderStatus.ready,
      pickup_type: PickupType.delivery,
      community_id: community.id,
      receiver_name: 'Receiver Secret A',
      receiver_phone: '13948111111',
      receiver_address: '南京市玄武区响应隐私测试路88号',
      created_at: now,
      paid_at: now,
    },
  });
  const normalOrderB = await prisma.order.create({
    data: {
      id: `${prefix}-order-normal-b`,
      order_no: `${prefix}-order-no-normal-b`,
      user_id: customerB.id,
      product_id: product.id,
      total_amount_cents: 1800,
      product_amount_cents: 1800,
      pay_amount_cents: 1800,
      quantity: 1,
      pay_status: PayStatus.paid,
      order_status: OrderStatus.completed,
      pickup_type: PickupType.store,
      community_id: community.id,
      receiver_name: 'Receiver Secret B',
      receiver_phone: '13948222222',
      created_at: now,
      paid_at: now,
      completed_at: now,
    },
  });

  async function createCommissionOrder(
    suffix: string,
    userId: string,
    leaderId: string,
    groupBuyId: string,
  ) {
    return prisma.order.create({
      data: {
        id: `${prefix}-order-${suffix}`,
        order_no: `${prefix}-order-no-${suffix}`,
        user_id: userId,
        group_buy_id: groupBuyId,
        product_id: product.id,
        leader_user_id: leaderId,
        total_amount_cents: 1800,
        product_amount_cents: 1800,
        pay_amount_cents: 1800,
        quantity: 1,
        pay_status: PayStatus.paid,
        order_status: OrderStatus.completed,
        pickup_type: PickupType.store,
        community_id: community.id,
        receiver_name: `Receiver ${suffix}`,
        receiver_phone: '13948333333',
        created_at: now,
        paid_at: now,
        completed_at: now,
      },
    });
  }

  const commissionOrderA = await createCommissionOrder(
    'commission-a',
    customerB.id,
    leaderA.id,
    groupA.id,
  );
  const withdrawableOrderA = await createCommissionOrder(
    'withdrawable-a',
    customerB.id,
    leaderA.id,
    groupA.id,
  );
  const commissionOrderB = await createCommissionOrder(
    'commission-b',
    customerA.id,
    leaderB.id,
    groupB.id,
  );

  const commissionA = await prisma.commission.create({
    data: {
      id: `${prefix}-commission-a`,
      leader_user_id: leaderA.id,
      order_id: commissionOrderA.id,
      group_buy_id: groupA.id,
      base_amount_cents: 1800,
      commission_type: 'fixed',
      commission_value: 700,
      estimated_amount_cents: 700,
      final_amount_cents: 700,
      status: CommissionStatus.available,
      available_at: now,
    },
  });
  const withdrawableCommissionA = await prisma.commission.create({
    data: {
      id: `${prefix}-commission-withdrawable-a`,
      leader_user_id: leaderA.id,
      order_id: withdrawableOrderA.id,
      group_buy_id: groupA.id,
      base_amount_cents: 1800,
      commission_type: 'fixed',
      commission_value: 300,
      estimated_amount_cents: 300,
      final_amount_cents: 300,
      status: CommissionStatus.available,
      available_at: now,
    },
  });
  const commissionB = await prisma.commission.create({
    data: {
      id: `${prefix}-commission-b`,
      leader_user_id: leaderB.id,
      order_id: commissionOrderB.id,
      group_buy_id: groupB.id,
      base_amount_cents: 1800,
      commission_type: 'fixed',
      commission_value: 900,
      estimated_amount_cents: 900,
      final_amount_cents: 900,
      status: CommissionStatus.available,
      available_at: now,
    },
  });

  await prisma.rewardLedger.createMany({
    data: [
      {
        id: `${prefix}-reward-ledger-a`,
        leader_user_id: leaderA.id,
        commission_id: commissionA.id,
        order_id: commissionOrderA.id,
        idempotency_key: `${prefix}-reward-ledger-a-key`,
        event_type: 'l48_fixture_available',
        entry_type: 'commission_available',
        direction: 'in',
        amount_cents: 1000,
        affects_available_balance: true,
        balance_after_cents: 1000,
        effective_at: now,
      },
      {
        id: `${prefix}-reward-ledger-b`,
        leader_user_id: leaderB.id,
        commission_id: commissionB.id,
        order_id: commissionOrderB.id,
        idempotency_key: `${prefix}-reward-ledger-b-key`,
        event_type: 'l48_fixture_available',
        entry_type: 'commission_available',
        direction: 'in',
        amount_cents: 900,
        affects_available_balance: true,
        balance_after_cents: 900,
        effective_at: now,
      },
    ],
  });

  const withdrawalA = await prisma.withdrawal.create({
    data: {
      id: `${prefix}-withdrawal-a`,
      leader_user_id: leaderA.id,
      amount_cents: 3200,
      status: WithdrawalStatus.rejected,
      client_request_id: `${prefix}-withdrawal-request-a`,
      taxable_amount_cents: 3200,
      payable_amount_cents: 3200,
      tax_remark: `${prefix}-tax-remark-secret`,
      admin_remark: `${prefix}-admin-remark-secret`,
      reviewed_by_admin_id: `${prefix}-review-admin-secret`,
      processed_by_admin_id: `${prefix}-process-admin-secret`,
      manual_reference: `${prefix}-manual-reference-secret-88`,
      reviewed_at: now,
      rejected_at: now,
      created_at: now,
    },
  });
  const withdrawalB = await prisma.withdrawal.create({
    data: {
      id: `${prefix}-withdrawal-b`,
      leader_user_id: leaderB.id,
      amount_cents: 900,
      status: WithdrawalStatus.pending,
      client_request_id: `${prefix}-withdrawal-request-b`,
      taxable_amount_cents: 900,
      payable_amount_cents: 900,
      created_at: now,
    },
  });

  return {
    customerA,
    customerB,
    inactive,
    leaderA,
    leaderB,
    normalOrderA,
    normalOrderB,
    commissionA,
    withdrawableCommissionA,
    commissionB,
    withdrawalA,
    withdrawalB,
  };
}

async function verifyBusinessLogFallback(): Promise<void> {
  const errorMarker = `${prefix}-unique-db-host-secret`;
  const stackMarker = `${prefix}-unique-stack-secret`;
  const payloadMarker = `${prefix}-unique-payload-secret`;
  const captured: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };

  try {
    const failure = Object.assign(new Error(errorMarker), {
      name: 'PrismaClientKnownRequestError',
      code: 'P9999',
      stack: stackMarker,
    });
    const failingClient = {
      businessEventLog: {
        create: async () => {
          throw failure;
        },
      },
    } as any;
    await safeRecordBusinessEvent(failingClient, {
      event_type: 'l48_logging_failure_test',
      event_source: 'l48-e2e',
      trace_id: `${prefix}-trace`,
      request_id: `${prefix}-request`,
      payload: { secret_input: payloadMarker },
    });
  } finally {
    console.error = originalConsoleError;
  }

  const serialized = JSON.stringify(captured);
  assert(serialized.includes('recordBusinessEvent'), 'Safe log fallback operation missing');
  assert(serialized.includes('P9999'), 'Safe log fallback stable error code missing');
  for (const secret of [errorMarker, stackMarker, payloadMarker]) {
    assert(!serialized.includes(secret), `Safe log fallback exposed ${secret}`);
  }
}

function verifyResponsePrivacy(forbiddenValues: string[]): void {
  const prohibitedPaths = capturedBodies.flatMap((body, index) =>
    findProhibitedResponsePaths(body, `$responses[${index}]`),
  );
  assert(
    prohibitedPaths.length === 0,
    `L48 response privacy found prohibited keys: ${prohibitedPaths.join(', ')}`,
  );

  const serialized = JSON.stringify(capturedBodies);
  for (const key of L48_PROHIBITED_RESPONSE_KEYS) {
    assert(
      !serialized.includes(`"${key}"`),
      `L48 response exposed prohibited key ${key}`,
    );
  }
  for (const value of forbiddenValues) {
    assert(!serialized.includes(value), `L48 response exposed fixture value ${value}`);
  }
}

async function runScenario(): Promise<void> {
  capturedBodies.length = 0;
  await cleanup();
  try {
    const fixtures = await createFixtures();
    const customerHeaders = { 'x-user-id': fixtures.customerA.id };
    const leaderHeaders = { 'x-user-id': fixtures.leaderA.id };

    await requestJson(
      `/api/me/orders?user_id=${encodeURIComponent(fixtures.customerA.id)}`,
      { expectedStatus: 401 },
    );

    const orderList = await requestJson<{
      items: Array<{ order_id: string }>;
    }>(
      `/api/me/orders?type=normal&user_id=${encodeURIComponent(fixtures.customerB.id)}`,
      { headers: customerHeaders },
    );
    assert(orderList.body.data.items.length === 1, 'Header-scoped order list must contain one normal order');
    assert(
      orderList.body.data.items[0]?.order_id === fixtures.normalOrderA.id,
      'Conflicting query identity changed order ownership',
    );
    assert(
      !orderList.text.includes(fixtures.normalOrderB.id),
      'Customer B order leaked into customer A response',
    );

    const orderDetail = await requestJson<any>(
      `/api/me/orders/${fixtures.normalOrderA.id}`,
      { headers: customerHeaders },
    );
    assert(
      orderDetail.body.data.receiver.receiver_name_masked === 'R*',
      'Receiver name mask mismatch',
    );
    assert(
      orderDetail.body.data.receiver.receiver_phone_masked === '139****1111',
      'Receiver phone mask mismatch',
    );
    assert(
      orderDetail.body.data.receiver.receiver_address_masked === '南京市***8号',
      'Receiver address mask mismatch',
    );

    await requestJson(`/api/me/orders/${fixtures.normalOrderA.id}/pickup-code`, {
      headers: customerHeaders,
    });
    await requestJson(`/api/me/orders/${fixtures.normalOrderA.id}/after-sales`, {
      headers: customerHeaders,
    });
    await requestJson('/api/me/center-summary', { headers: customerHeaders });

    await requestJson('/api/me/orders', {
      headers: { 'x-user-id': fixtures.inactive.id },
      expectedStatus: 403,
    });

    const nonLeaderRequests: Array<{
      path: string;
      method?: 'GET' | 'POST';
      body?: unknown;
    }> = [
      { path: '/api/leaders/me/center-summary' },
      { path: '/api/leaders/me/withdrawals' },
      { path: `/api/leaders/me/withdrawals/${fixtures.withdrawalA.id}` },
      { path: '/api/leaders/me/withdrawable-commissions' },
      {
        path: '/api/leaders/me/withdrawals',
        method: 'POST',
        body: {
          leader_user_id: fixtures.leaderB.id,
          openid: fixtures.leaderB.openid,
          client_request_id: `${prefix}-non-leader-withdrawal`,
          commission_ids: [fixtures.withdrawableCommissionA.id],
        },
      },
      {
        path: '/api/leaders/me/rewards/convert-credit',
        method: 'POST',
        body: {
          leader_user_id: fixtures.leaderB.id,
          commission_ids: [fixtures.commissionA.id],
          amount_cents: 700,
          client_request_id: `${prefix}-non-leader-conversion`,
        },
      },
    ];
    for (const item of nonLeaderRequests) {
      await requestJson(item.path, {
        method: item.method,
        body: item.body,
        headers: customerHeaders,
        expectedStatus: 403,
      });
    }

    await requestJson('/api/leaders/me/center-summary', {
      headers: leaderHeaders,
    });
    const withdrawalList = await requestJson<any[]>(
      '/api/leaders/me/withdrawals',
      { headers: leaderHeaders },
    );
    assert(withdrawalList.body.data.length === 1, 'Leader A withdrawal list must contain only own row');
    assert(
      withdrawalList.body.data[0]?.withdrawal_id === fixtures.withdrawalA.id,
      'Leader A withdrawal list returned another leader row',
    );
    assert(
      withdrawalList.body.data[0]?.rejection_reason ===
        '提现申请未通过，请联系平台',
      'Rejected withdrawal must use the fixed public explanation',
    );
    assert(
      typeof withdrawalList.body.data[0]?.manual_reference_masked === 'string',
      'Rejected withdrawal must expose only a masked manual reference',
    );
    await requestJson(`/api/leaders/me/withdrawals/${fixtures.withdrawalA.id}`, {
      headers: leaderHeaders,
    });
    const withdrawable = await requestJson<any>(
      '/api/leaders/me/withdrawable-commissions',
      { headers: leaderHeaders },
    );
    assert(
      withdrawable.body.data.items.every(
        (item: { commission_id: string }) => item.commission_id !== fixtures.commissionB.id,
      ),
      'Leader B commission leaked into leader A withdrawable list',
    );

    await requestJson(`/api/leaders/me/withdrawals/${fixtures.withdrawalB.id}`, {
      headers: leaderHeaders,
      expectedStatus: 404,
    });

    await requestJson('/api/leaders/me/rewards/convert-credit', {
      method: 'POST',
      headers: leaderHeaders,
      body: {
        leader_user_id: fixtures.leaderA.id,
        commission_ids: [fixtures.commissionB.id],
        amount_cents: 900,
        client_request_id: `${prefix}-cross-leader-conversion`,
      },
      expectedStatus: 404,
    });

    const conversionRequestId = `${prefix}-body-conflict-conversion`;
    const conversion = await requestJson<any>(
      '/api/leaders/me/rewards/convert-credit',
      {
        method: 'POST',
        headers: leaderHeaders,
        body: {
          leader_user_id: fixtures.leaderB.id,
          commission_ids: [fixtures.commissionA.id],
          amount_cents: 700,
          client_request_id: conversionRequestId,
        },
      },
    );
    assert(
      conversion.body.data.commission_id === fixtures.commissionA.id &&
        conversion.body.data.amount_cents === 700 &&
        conversion.body.data.idempotent === false,
      'Reward conversion public DTO mismatch',
    );
    const persistedConversion = await prisma.rewardConversion.findUnique({
      where: { client_request_id: conversionRequestId },
    });
    assert(
      persistedConversion?.leader_user_id === fixtures.leaderA.id,
      'Body identity changed persisted reward conversion owner',
    );

    await requestJson(
      `/api/me/orders?user_id=${encodeURIComponent(HTTP_LOG_MARKER)}&phone=${HTTP_LOG_PHONE}`,
      {
        headers: {
          'x-user-id': HTTP_LOG_MARKER,
          'x-openid': HTTP_LOG_MARKER,
          authorization: `Bearer ${HTTP_LOG_MARKER}`,
          cookie: `session=${HTTP_LOG_MARKER}`,
          'x-admin-token': HTTP_LOG_MARKER,
        },
        expectedStatus: 404,
      },
    );
    await requestJson('/api/leaders/me/rewards/convert-credit', {
      method: 'POST',
      headers: { 'x-user-id': HTTP_LOG_MARKER },
      body: {
        leader_user_id: HTTP_LOG_MARKER,
        commission_ids: [HTTP_LOG_MARKER],
        amount_cents: 100,
        client_request_id: HTTP_LOG_MARKER,
        receiver_phone: HTTP_LOG_PHONE,
        receiver_address: `${HTTP_LOG_MARKER}-address`,
      },
      expectedStatus: 404,
    });

    verifyResponsePrivacy([
      fixtures.customerA.openid,
      fixtures.customerA.unionid ?? '',
      fixtures.customerA.phone ?? '',
      fixtures.customerB.openid,
      fixtures.customerB.phone ?? '',
      fixtures.leaderA.openid,
      fixtures.leaderA.phone ?? '',
      fixtures.leaderB.openid,
      fixtures.leaderB.phone ?? '',
      'Receiver Secret A',
      '13948111111',
      '南京市玄武区响应隐私测试路88号',
      `${prefix}-tax-remark-secret`,
      `${prefix}-admin-remark-secret`,
      `${prefix}-review-admin-secret`,
      `${prefix}-process-admin-secret`,
      `${prefix}-manual-reference-secret-88`,
    ]);

    await verifyBusinessLogFallback();

    emitMarker(markers.queryOnlyIdentity);
    emitMarker(markers.headerIdentityWins);
    emitMarker(markers.inactiveForbidden);
    emitMarker(markers.nonLeaderForbidden);
    emitMarker(markers.rewardOwnerScope);
    emitMarker(markers.withdrawalOwnerScope);
    emitMarker(markers.responsePrivacy);
    emitMarker(markers.businessLogPrivacy);
    console.log('L48 security privacy API scenario passed.');
  } finally {
    await cleanup();
  }
}

async function main(): Promise<void> {
  assert(
    findProhibitedResponsePaths({ nested: { openid: 'x' } }).join(',') ===
      '$.nested.openid',
    'L48 recursive response scanner self-check failed',
  );
  await waitForApiReady();
  await runScenario();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
