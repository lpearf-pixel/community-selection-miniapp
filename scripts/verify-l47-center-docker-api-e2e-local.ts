import {
  CommissionStatus,
  GroupBuyStatus,
  OrderStatus,
  PayStatus,
  PickupType,
  PrismaClient,
  WithdrawalStatus,
} from '@prisma/client';
import type {
  LeaderCenterSummary,
  MeCenterSummary,
} from '../apps/api/src/modules/me-center/me-center-types.js';
import {
  L47_PROHIBITED_RESPONSE_KEYS,
  L47_RUNTIME_MARKERS,
} from './l47-center-contract.ts';
import { consumerVerifierHeaders } from './lib/consumer-verifier-request.ts';

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message: string;
};

type RequestOptions = {
  headers?: Record<string, string>;
  userId?: string;
  expectedStatus?: number;
};

const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://127.0.0.1:13080').replace(/\/$/, '');
const prisma = new PrismaClient();

const markers = {
  meSuccess: 'l47_me_center_summary_success=true',
  meOrders: 'l47_me_center_order_counts_verified=true',
  meAfterSales: 'l47_me_center_after_sale_count_verified=true',
  leaderSuccess: 'l47_leader_center_summary_success=true',
  leaderGroups: 'l47_leader_group_buy_counts_verified=true',
  leaderRewards: 'l47_leader_reward_amounts_verified=true',
  leaderWithdrawals: 'l47_leader_withdrawal_summary_verified=true',
  nonLeaderForbidden: 'l47_non_leader_forbidden=true',
  sensitiveAbsent: 'l47_sensitive_fields_absent=true',
  navigation: 'l47_miniapp_navigation_verified=true',
} as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function emitMarker(marker: (typeof markers)[keyof typeof markers]): void {
  assert(
    new Set<string>(L47_RUNTIME_MARKERS).has(marker),
    `L47 marker is not registered in the contract: ${marker}`,
  );
  console.log(marker);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiReady(maxAttempts = 60): Promise<void> {
  let lastError = 'not attempted';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`L47 Docker API did not become ready: ${lastError}`);
}

async function requestData<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: options.userId
      ? consumerVerifierHeaders(options.userId, options.headers)
      : options.headers,
  });
  const text = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(`L47 ${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (options.expectedStatus !== undefined) {
    assert(
      response.status === options.expectedStatus,
      `L47 ${path} expected HTTP ${options.expectedStatus}, received ${response.status}: ${body.message}`,
    );
    assert(body.success === false, `L47 ${path} expected success=false for HTTP ${response.status}`);
    return body.data;
  }

  assert(response.ok, `L47 ${path} failed with HTTP ${response.status}: ${body.message}`);
  assert(body.success === true, `L47 ${path} must return success=true: ${body.message}`);
  return body.data;
}

async function cleanup(prefix: string): Promise<void> {
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
        { id: { startsWith: prefix } },
        { order_id: { startsWith: prefix } },
        { commission_id: { startsWith: prefix } },
        { withdrawal_id: { startsWith: prefix } },
        { idempotency_key: { startsWith: prefix } },
      ],
    },
  });
  await prisma.commission.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { order_id: { startsWith: prefix } },
        { group_buy_id: { startsWith: prefix } },
      ],
    },
  });
  await prisma.withdrawal.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.afterSaleCase.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.order.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.groupBuy.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.product.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.category.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.community.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

function assertSensitiveFieldsAbsent(payloads: unknown[], forbiddenValues: string[]): void {
  const serialized = JSON.stringify(payloads);
  for (const key of L47_PROHIBITED_RESPONSE_KEYS) {
    assert(!serialized.includes(`"${key}"`), `L47 center response exposed prohibited key: ${key}`);
  }
  for (const value of forbiddenValues) {
    assert(!serialized.includes(value), `L47 center response exposed prohibited fixture value: ${value}`);
  }
}

async function runL47CenterScenario(): Promise<void> {
  const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const prefix = `l47-${runToken}`;
  const now = new Date('2026-07-18T00:00:00.000Z');
  const customerOpenid = `${prefix}-customer-openid`;
  const leaderOpenid = `${prefix}-leader-openid`;
  const buyerOpenid = `${prefix}-buyer-openid`;
  const customerPhone = '13147000001';
  const leaderOrderPhone = '13147000002';

  await cleanup(prefix);

  try {
    const customer = await prisma.user.create({
      data: {
        id: `${prefix}-customer`,
        openid: customerOpenid,
        nickname: 'L47 Customer',
        role: 'customer',
      },
    });
    const leader = await prisma.user.create({
      data: {
        id: `${prefix}-leader`,
        openid: leaderOpenid,
        nickname: 'L47 Leader',
        role: 'leader',
      },
    });
    const buyer = await prisma.user.create({
      data: {
        id: `${prefix}-buyer`,
        openid: buyerOpenid,
        nickname: 'L47 Supporting Buyer',
        role: 'customer',
      },
    });
    const category = await prisma.category.create({
      data: {
        id: `${prefix}-category`,
        name: `${prefix}-category`,
        sort_order: 47,
      },
    });
    const product = await prisma.product.create({
      data: {
        id: `${prefix}-product`,
        name: `${prefix}-product`,
        category_id: category.id,
        price_cents: 1000,
        cost_price_cents: 500,
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
        address: `${prefix}-address`,
      },
    });

    const orderBase = {
      user_id: customer.id,
      product_id: product.id,
      total_amount_cents: 1000,
      product_amount_cents: 1000,
      delivery_fee_cents: 0,
      pay_amount_cents: 1000,
      quantity: 1,
      refund_status: 'none' as const,
      community_id: community.id,
      receiver_name: 'L47 Customer',
      receiver_phone: customerPhone,
      created_at: now,
    };

    const unpaidOrder = await prisma.order.create({
      data: {
        ...orderBase,
        id: `${prefix}-order-unpaid`,
        order_no: `${prefix}-order-no-unpaid`,
        pay_status: PayStatus.unpaid,
        order_status: OrderStatus.unpaid,
        pickup_type: PickupType.store,
      },
    });
    const preparingOrder = await prisma.order.create({
      data: {
        ...orderBase,
        id: `${prefix}-order-preparing`,
        order_no: `${prefix}-order-no-preparing`,
        pay_status: PayStatus.paid,
        order_status: OrderStatus.preparing,
        pickup_type: PickupType.store,
        paid_at: now,
      },
    });
    const readyStoreOrder = await prisma.order.create({
      data: {
        ...orderBase,
        id: `${prefix}-order-ready-store`,
        order_no: `${prefix}-order-no-ready-store`,
        pay_status: PayStatus.paid,
        order_status: OrderStatus.ready,
        pickup_type: PickupType.store,
        paid_at: now,
      },
    });
    const readyDeliveryOrder = await prisma.order.create({
      data: {
        ...orderBase,
        id: `${prefix}-order-ready-delivery`,
        order_no: `${prefix}-order-no-ready-delivery`,
        pay_status: PayStatus.paid,
        order_status: OrderStatus.ready,
        pickup_type: PickupType.delivery,
        receiver_address: `${prefix}-delivery-address`,
        paid_at: now,
      },
    });
    const completedOrder = await prisma.order.create({
      data: {
        ...orderBase,
        id: `${prefix}-order-completed`,
        order_no: `${prefix}-order-no-completed`,
        pay_status: PayStatus.paid,
        order_status: OrderStatus.completed,
        pickup_type: PickupType.store,
        paid_at: now,
        completed_at: now,
      },
    });

    await prisma.afterSaleCase.createMany({
      data: [
        {
          id: `${prefix}-after-sale-pending`,
          order_id: completedOrder.id,
          user_id: customer.id,
          product_id: product.id,
          type: 'refund',
          status: 'submitted',
          reason: 'L47 pending fixture',
        },
        {
          id: `${prefix}-after-sale-resolved`,
          order_id: preparingOrder.id,
          user_id: customer.id,
          product_id: product.id,
          type: 'refund',
          status: 'resolved',
          reason: 'L47 resolved fixture',
          resolved_at: now,
        },
      ],
    });

    const groupBase = {
      product_id: product.id,
      leader_user_id: leader.id,
      community_id: community.id,
      min_people: 1,
      min_quantity: 1,
      current_people: 1,
      current_quantity: 1,
      price_cents: 1000,
      start_time: now,
      end_time: new Date(now.getTime() + 86_400_000),
      pickup_time: new Date(now.getTime() + 172_800_000),
    };
    await prisma.groupBuy.create({
      data: {
        ...groupBase,
        id: `${prefix}-group-pending`,
        status: GroupBuyStatus.pending,
      },
    });
    const successGroup = await prisma.groupBuy.create({
      data: {
        ...groupBase,
        id: `${prefix}-group-success`,
        status: GroupBuyStatus.success,
      },
    });
    await prisma.groupBuy.create({
      data: {
        ...groupBase,
        id: `${prefix}-group-failed`,
        status: GroupBuyStatus.failed,
      },
    });

    const commissionOrder = await prisma.order.create({
      data: {
        id: `${prefix}-commission-order`,
        order_no: `${prefix}-commission-order-no`,
        user_id: buyer.id,
        group_buy_id: successGroup.id,
        product_id: product.id,
        leader_user_id: leader.id,
        total_amount_cents: 1000,
        product_amount_cents: 1000,
        delivery_fee_cents: 0,
        pay_amount_cents: 1000,
        quantity: 1,
        pay_status: PayStatus.paid,
        order_status: OrderStatus.completed,
        refund_status: 'none',
        pickup_type: PickupType.store,
        community_id: community.id,
        receiver_name: 'L47 Supporting Buyer',
        receiver_phone: leaderOrderPhone,
        created_at: now,
        paid_at: now,
        completed_at: now,
      },
    });
    const commission = await prisma.commission.create({
      data: {
        id: `${prefix}-commission`,
        leader_user_id: leader.id,
        order_id: commissionOrder.id,
        group_buy_id: successGroup.id,
        base_amount_cents: 1000,
        commission_type: 'fixed',
        commission_value: 700,
        estimated_amount_cents: 700,
        final_amount_cents: 700,
        status: CommissionStatus.pending,
        available_at: new Date(now.getTime() + 3 * 86_400_000),
      },
    });

    await prisma.rewardLedger.createMany({
      data: [
        {
          id: `${prefix}-ledger-in`,
          leader_user_id: leader.id,
          commission_id: commission.id,
          order_id: commissionOrder.id,
          idempotency_key: `${prefix}-ledger-in-key`,
          event_type: 'l47_fixture_available',
          entry_type: 'commission_available',
          direction: 'in',
          amount_cents: 1200,
          affects_available_balance: true,
          balance_after_cents: 1200,
          effective_at: now,
        },
        {
          id: `${prefix}-ledger-out`,
          leader_user_id: leader.id,
          commission_id: commission.id,
          order_id: commissionOrder.id,
          idempotency_key: `${prefix}-ledger-out-key`,
          event_type: 'l47_fixture_deduct',
          entry_type: 'commission_deduct',
          direction: 'out',
          amount_cents: 300,
          affects_available_balance: true,
          balance_after_cents: 900,
          effective_at: new Date(now.getTime() + 1_000),
        },
      ],
    });

    const withdrawalFixtures = [
      { suffix: 'rejected-oldest', status: WithdrawalStatus.rejected, amount: 10, minute: 0 },
      { suffix: 'rejected-middle', status: WithdrawalStatus.rejected, amount: 20, minute: 1 },
      { suffix: 'rejected-newest', status: WithdrawalStatus.rejected, amount: 30, minute: 2 },
      { suffix: 'paid', status: WithdrawalStatus.paid, amount: 500, minute: 3 },
      { suffix: 'approved', status: WithdrawalStatus.approved, amount: 200, minute: 4 },
      { suffix: 'pending', status: WithdrawalStatus.pending, amount: 400, minute: 5 },
    ];
    for (const item of withdrawalFixtures) {
      await prisma.withdrawal.create({
        data: {
          id: `${prefix}-withdrawal-${item.suffix}`,
          leader_user_id: leader.id,
          amount_cents: item.amount,
          status: item.status,
          client_request_id: `${prefix}-withdrawal-request-${item.suffix}`,
          payable_amount_cents: item.amount,
          created_at: new Date(now.getTime() + item.minute * 60_000),
        },
      });
    }

    const me = await requestData<MeCenterSummary>('/api/me/center-summary', {
      userId: customer.id,
    });
    assert(me.profile.user_id === customer.id, 'L47 personal profile user mismatch');
    assert(me.profile.role === 'user', 'L47 customer profile role mismatch');
    emitMarker(markers.meSuccess);

    assert(me.orders.total_count === 5, `L47 total order count expected=5 actual=${me.orders.total_count}`);
    assert(me.orders.unpaid_count === 1, `L47 unpaid count expected=1 actual=${me.orders.unpaid_count}`);
    assert(me.orders.pending_fulfillment_count === 1, `L47 pending fulfillment expected=1 actual=${me.orders.pending_fulfillment_count}`);
    assert(me.orders.ready_for_pickup_count === 1, `L47 ready pickup expected=1 actual=${me.orders.ready_for_pickup_count}`);
    assert(me.orders.in_delivery_count === 1, `L47 in delivery expected=1 actual=${me.orders.in_delivery_count}`);
    assert(me.orders.completed_count === 1, `L47 completed expected=1 actual=${me.orders.completed_count}`);
    assert(unpaidOrder.id.startsWith(prefix) && readyStoreOrder.id.startsWith(prefix) && readyDeliveryOrder.id.startsWith(prefix), 'L47 order fixtures must use the run prefix');
    emitMarker(markers.meOrders);

    assert(me.after_sales.pending_count === 1, `L47 pending after-sale expected=1 actual=${me.after_sales.pending_count}`);
    emitMarker(markers.meAfterSales);

    await requestData<null>('/api/leaders/me/center-summary', {
      userId: customer.id,
      expectedStatus: 403,
    });
    emitMarker(markers.nonLeaderForbidden);

    const leaderSummary = await requestData<LeaderCenterSummary>('/api/leaders/me/center-summary', {
      userId: leader.id,
    });
    assert(leaderSummary.updated_at.length > 0, 'L47 leader summary timestamp missing');
    emitMarker(markers.leaderSuccess);

    assert(leaderSummary.group_buys.total_count === 3, `L47 total group buys expected=3 actual=${leaderSummary.group_buys.total_count}`);
    assert(leaderSummary.group_buys.active_count === 1, `L47 active group buys expected=1 actual=${leaderSummary.group_buys.active_count}`);
    assert(leaderSummary.group_buys.success_count === 1, `L47 success group buys expected=1 actual=${leaderSummary.group_buys.success_count}`);
    assert(leaderSummary.group_buys.failed_count === 1, `L47 failed group buys expected=1 actual=${leaderSummary.group_buys.failed_count}`);
    emitMarker(markers.leaderGroups);

    assert(leaderSummary.rewards.pending_cents === 700, `L47 pending rewards expected=700 actual=${leaderSummary.rewards.pending_cents}`);
    assert(leaderSummary.rewards.available_cents === 900, `L47 available rewards expected=900 actual=${leaderSummary.rewards.available_cents}`);
    assert(leaderSummary.rewards.withdrawing_cents === 600, `L47 withdrawing rewards expected=600 actual=${leaderSummary.rewards.withdrawing_cents}`);
    assert(leaderSummary.rewards.withdrawn_cents === 500, `L47 withdrawn rewards expected=500 actual=${leaderSummary.rewards.withdrawn_cents}`);
    emitMarker(markers.leaderRewards);

    const expectedLatestIds = [
      `${prefix}-withdrawal-pending`,
      `${prefix}-withdrawal-approved`,
      `${prefix}-withdrawal-paid`,
      `${prefix}-withdrawal-rejected-newest`,
      `${prefix}-withdrawal-rejected-middle`,
    ];
    assert(leaderSummary.withdrawals.pending_count === 1, 'L47 pending withdrawal count mismatch');
    assert(leaderSummary.withdrawals.approved_count === 1, 'L47 approved withdrawal count mismatch');
    assert(leaderSummary.withdrawals.rejected_count === 3, 'L47 rejected withdrawal count mismatch');
    assert(leaderSummary.withdrawals.processed_count === 1, 'L47 processed withdrawal count mismatch');
    assert(leaderSummary.withdrawals.latest.length === 5, 'L47 latest withdrawals must be limited to five');
    assert(
      JSON.stringify(leaderSummary.withdrawals.latest.map((item) => item.withdrawal_id)) === JSON.stringify(expectedLatestIds),
      `L47 latest withdrawal order mismatch: ${JSON.stringify(leaderSummary.withdrawals.latest.map((item) => item.withdrawal_id))}`,
    );
    emitMarker(markers.leaderWithdrawals);

    assertSensitiveFieldsAbsent(
      [me, leaderSummary],
      [customerOpenid, leaderOpenid, buyerOpenid, customerPhone, leaderOrderPhone],
    );
    emitMarker(markers.sensitiveAbsent);

    assert(me.navigation.leader_center_available === false, 'L47 customer must not receive leader-center entry');
    assert(leaderSummary.navigation.withdrawal_entry_available === true, 'L47 leader withdrawal entry must be available');
    emitMarker(markers.navigation);
  } finally {
    await cleanup(prefix);
  }
}

async function main(): Promise<void> {
  await waitForApiReady();
  await runL47CenterScenario();
  console.log('L47 center Docker API E2E verification passed.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
