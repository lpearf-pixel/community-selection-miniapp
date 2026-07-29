import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { prisma } from '../../db.js';
import { createGroupOrder, createNormalOrder } from './order-service.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  category: `l53b-category-${suffix}`,
  product: `l53b-product-${suffix}`,
  community: `l53b-community-${suffix}`,
  store: `l53b-store-${suffix}`,
  leaderOpenid: `l53b-leader-${suffix}`,
  buyerOpenid: `l53b-buyer-${suffix}`,
};

let leaderId = '';
let buyerId = '';
let groupBuyId = '';
let deliveryRuleId = '';

beforeAll(async () => {
  const category = await prisma.category.create({
    data: { id: ids.category, name: `L53B category ${suffix}` },
  });
  await prisma.product.create({
    data: {
      id: ids.product,
      name: `L53B product ${suffix}`,
      category_id: category.id,
      price_cents: 1_200,
      cost_price_cents: 700,
      stock: 100,
      unit: '份',
      status: 'active',
    },
  });
  await prisma.community.create({
    data: {
      id: ids.community,
      name: `L53B community ${suffix}`,
      address: '测试社区 1 号',
    },
  });
  await prisma.pickupStore.create({
    data: {
      id: ids.store,
      name: `L53B store ${suffix}`,
      address: '测试门店 1 号',
      phone: '02588888888',
    },
  });
  const leader = await prisma.user.create({
    data: {
      openid: ids.leaderOpenid,
      nickname: 'L53B leader',
      role: 'leader',
    },
  });
  const buyer = await prisma.user.create({
    data: {
      openid: ids.buyerOpenid,
      nickname: 'L53B buyer',
      role: 'customer',
    },
  });
  leaderId = leader.id;
  buyerId = buyer.id;
  const groupBuy = await prisma.groupBuy.create({
    data: {
      product_id: ids.product,
      leader_user_id: leader.id,
      community_id: ids.community,
      min_people: 2,
      min_quantity: 2,
      price_cents: 1_000,
      start_time: new Date('2026-07-28T00:00:00.000Z'),
      end_time: new Date('2026-07-30T00:00:00.000Z'),
      pickup_time: new Date('2026-07-31T02:30:00.000Z'),
    },
  });
  groupBuyId = groupBuy.id;
  const rule = await prisma.deliveryRuleConfig.create({
    data: {
      pickup_store_id: ids.store,
      enabled: true,
      base_fee_cents: 500,
      free_threshold_cents: null,
      max_distance_km: null,
      service_radius_text: '测试门店周边 3km',
      notice: '测试配送规则',
      time_windows_json: [
        {
          code: 'today_afternoon',
          label: '今日下午',
          start_time: '14:00',
          end_time: '18:00',
          day_offset: 0,
        },
      ],
    },
  });
  deliveryRuleId = rule.id;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  const orders = await prisma.order.findMany({
    where: {
      client_request_id: { startsWith: `l53b-${suffix}-` },
    },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length > 0) {
    await prisma.orderTimelineLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.businessEventLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.consumerCreditLedger.deleteMany({
      where: { source_id: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  await prisma.groupBuy.delete({ where: { id: groupBuyId } });
  await prisma.deliveryRuleConfig.delete({ where: { id: deliveryRuleId } });
  await prisma.user.deleteMany({ where: { id: { in: [leaderId, buyerId] } } });
  await prisma.pickupStore.delete({ where: { id: ids.store } });
  await prisma.community.delete({ where: { id: ids.community } });
  await prisma.product.delete({ where: { id: ids.product } });
  await prisma.category.delete({ where: { id: ids.category } });
  await prisma.$disconnect();
});

describe('L53-B order fulfillment promise persistence', () => {
  it('persists delivery, group pickup, and normal pickup promises with the order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T01:30:00.000Z'));

    const delivery = (await createNormalOrder({
      product_id: ids.product,
      user_id: buyerId,
      client_request_id: `l53b-${suffix}-delivery`,
      quantity: 1,
      pickup_type: 'delivery',
      pickup_store_id: ids.store,
      community_id: ids.community,
      receiver_name: '配送用户',
      receiver_phone: '13800000001',
      receiver_address: '测试社区 1 号 101 室',
      delivery_time_window_code: 'today_afternoon',
    })) as any;

    expect(delivery.delivery_status).toBe('pending_dispatch');
    expect(delivery.promised_fulfillment_start_at.toISOString()).toBe(
      '2026-07-29T06:00:00.000Z',
    );
    expect(delivery.promised_fulfillment_end_at.toISOString()).toBe(
      '2026-07-29T10:00:00.000Z',
    );
    expect(delivery.fulfillment_promise_snapshot).toMatchObject({
      schema_version: 1,
      fulfillment_type: 'delivery',
      window_code: 'today_afternoon',
      display_text: '今日下午 14:00-18:00',
      source: 'delivery_rule',
      source_rule_id: deliveryRuleId,
      captured_at: '2026-07-29T01:30:00.000Z',
    });

    const groupPickup = (await createGroupOrder({
      group_buy_id: groupBuyId,
      user_id: buyerId,
      client_request_id: `l53b-${suffix}-group-pickup`,
      quantity: 1,
      pickup_type: 'store',
      pickup_store_id: ids.store,
      receiver_name: '团购自提用户',
      receiver_phone: '13800000002',
    })) as any;

    expect(groupPickup.delivery_status).toBeNull();
    expect(groupPickup.promised_fulfillment_start_at.toISOString()).toBe(
      '2026-07-31T02:30:00.000Z',
    );
    expect(groupPickup.promised_fulfillment_end_at).toBeNull();
    expect(groupPickup.fulfillment_promise_snapshot).toMatchObject({
      fulfillment_type: 'store',
      display_text: '2026年7月31日 10:30 自提',
      source: 'group_buy_pickup',
    });

    const normalPickup = (await createNormalOrder({
      product_id: ids.product,
      user_id: buyerId,
      client_request_id: `l53b-${suffix}-normal-pickup`,
      quantity: 1,
      pickup_type: 'store',
      pickup_store_id: ids.store,
      community_id: ids.community,
      receiver_name: '普通自提用户',
      receiver_phone: '13800000003',
    })) as any;

    expect(normalPickup.delivery_status).toBeNull();
    expect(normalPickup.promised_fulfillment_start_at).toBeNull();
    expect(normalPickup.promised_fulfillment_end_at).toBeNull();
    expect(normalPickup.fulfillment_promise_snapshot).toMatchObject({
      fulfillment_type: 'store',
      display_text: '门店确认后通知自提时间',
      source: 'store_confirmation_pending',
    });
  });

  it('replays the original promise after the delivery rule changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T01:30:00.000Z'));
    const clientRequestId = `l53b-${suffix}-idempotent`;
    const first = (await createNormalOrder({
      product_id: ids.product,
      user_id: buyerId,
      client_request_id: clientRequestId,
      quantity: 1,
      pickup_type: 'delivery',
      pickup_store_id: ids.store,
      community_id: ids.community,
      receiver_name: '幂等用户',
      receiver_phone: '13800000004',
      receiver_address: '测试社区 1 号 102 室',
      delivery_time_window_code: 'today_afternoon',
    })) as any;

    await prisma.deliveryRuleConfig.update({
      where: { id: deliveryRuleId },
      data: {
        time_windows_json: [
          {
            code: 'today_afternoon',
            label: '已修改时段',
            start_time: '15:00',
            end_time: '19:00',
            day_offset: 0,
          },
        ],
      },
    });

    const replay = (await createNormalOrder({
      product_id: ids.product,
      user_id: buyerId,
      client_request_id: clientRequestId,
      quantity: 1,
      pickup_type: 'delivery',
      pickup_store_id: ids.store,
      community_id: ids.community,
      receiver_name: '幂等用户',
      receiver_phone: '13800000004',
      receiver_address: '测试社区 1 号 102 室',
      delivery_time_window_code: 'today_afternoon',
    })) as any;

    expect(replay.id).toBe(first.id);
    expect(replay.fulfillment_promise_snapshot).toEqual(
      first.fulfillment_promise_snapshot,
    );
    expect(replay.fulfillment_promise_snapshot.display_text).toBe(
      '今日下午 14:00-18:00',
    );
  });
});
