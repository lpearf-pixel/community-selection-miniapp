import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  AdminDeliveryStatusError,
  executeAdminDeliveryStatusCommand,
} from './admin-delivery-status-executor.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `l53b-delivery-admin-${suffix}`,
  userOpenid: `l53b-delivery-user-${suffix}`,
  store: `l53b-delivery-store-${suffix}`,
  community: `l53b-delivery-community-${suffix}`,
  deliveryOrderNo: `L53B-D-${suffix}`,
  pickupOrderNo: `L53B-P-${suffix}`,
};
let userId = '';
let deliveryOrderId = '';
let pickupOrderId = '';

const promiseSnapshot = {
  schema_version: 1,
  fulfillment_type: 'delivery',
  window_code: 'today_afternoon',
  display_text: '今日下午 14:00-18:00',
  promised_start_at: '2026-07-29T06:00:00.000Z',
  promised_end_at: '2026-07-29T10:00:00.000Z',
  timezone: 'Asia/Shanghai',
  source: 'delivery_rule',
  captured_at: '2026-07-29T01:30:00.000Z',
};

const context = (): AdminAccessContext => ({
  admin_user_id: ids.admin,
  role: 'super_admin',
  permissions: ['admin.full_access'],
  is_super_admin: true,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: true,
    can_access_all_communities: true,
  },
  data_scope_source: 'session',
});

function command(
  idempotencyKey: string,
  deliveryStatus:
    | 'pending_dispatch'
    | 'delivering'
    | 'delivered'
    | 'exception' = 'delivering',
  expectedVersion = 1,
  remark?: string,
) {
  return {
    order_id: deliveryOrderId,
    command: {
      delivery_status: deliveryStatus,
      expected_version: expectedVersion,
      idempotency_key: idempotencyKey,
      ...(remark ? { remark } : {}),
    },
    context: context(),
    admin_meta: {},
  } as const;
}

async function sideEffectCounts() {
  const [events, audits, timeline] = await Promise.all([
    prisma.businessEventLog.count({ where: { order_id: deliveryOrderId } }),
    prisma.adminAuditLog.count({
      where: { target_type: 'Order', target_id: deliveryOrderId },
    }),
    prisma.orderTimelineLog.count({
      where: { order_id: deliveryOrderId },
    }),
  ]);
  return { events, audits, timeline };
}

beforeAll(async () => {
  await prisma.adminUser.create({
    data: {
      id: ids.admin,
      username: ids.admin,
      password_hash: 'integration-only',
      role: 'admin',
      status: 'active',
    },
  });
  const user = await prisma.user.create({
    data: {
      openid: ids.userOpenid,
      nickname: 'L53B delivery command user',
      role: 'customer',
    },
  });
  userId = user.id;
  await prisma.community.create({
    data: {
      id: ids.community,
      name: `L53B delivery community ${suffix}`,
      address: '测试社区 2 号',
    },
  });
  await prisma.pickupStore.create({
    data: {
      id: ids.store,
      name: `L53B delivery store ${suffix}`,
      address: '测试门店 2 号',
      phone: '02588888889',
    },
  });
  const deliveryOrder = await prisma.order.create({
    data: {
      order_no: ids.deliveryOrderNo,
      user_id: user.id,
      total_amount_cents: 1_000,
      product_amount_cents: 1_000,
      pay_amount_cents: 1_500,
      delivery_fee_cents: 500,
      pay_status: 'paid',
      order_status: 'paid',
      pickup_type: 'delivery',
      pickup_store_id: ids.store,
      community_id: ids.community,
      receiver_name: '配送测试用户',
      receiver_phone: '13800000005',
      receiver_address: '测试社区 2 号 201 室',
      delivery_status: 'pending_dispatch',
      delivery_status_updated_at: new Date(
        '2026-07-29T01:30:00.000Z',
      ),
      fulfillment_promise_snapshot: promiseSnapshot,
      promised_fulfillment_start_at: new Date(
        '2026-07-29T06:00:00.000Z',
      ),
      promised_fulfillment_end_at: new Date(
        '2026-07-29T10:00:00.000Z',
      ),
    },
  });
  deliveryOrderId = deliveryOrder.id;
  const pickupOrder = await prisma.order.create({
    data: {
      order_no: ids.pickupOrderNo,
      user_id: user.id,
      total_amount_cents: 1_000,
      product_amount_cents: 1_000,
      pay_amount_cents: 1_000,
      pay_status: 'paid',
      order_status: 'ready',
      pickup_type: 'store',
      pickup_store_id: ids.store,
      community_id: ids.community,
      receiver_name: '自提测试用户',
      receiver_phone: '13800000006',
    },
  });
  pickupOrderId = pickupOrder.id;
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.wechatShippingIntent.deleteMany({
      where: { order_id: deliveryOrderId },
    }),
    prisma.adminCommandReceipt.deleteMany({
      where: {
        admin_user_id: {
          in: [ids.admin, `missing-${ids.admin}`],
        },
      },
    }),
    prisma.businessEventLog.deleteMany({
      where: { order_id: deliveryOrderId },
    }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: deliveryOrderId },
    }),
    prisma.orderTimelineLog.deleteMany({
      where: { order_id: deliveryOrderId },
    }),
    prisma.order.update({
      where: { id: deliveryOrderId },
      data: {
        pay_status: 'paid',
        order_status: 'paid',
        delivery_status: 'pending_dispatch',
        version: 1,
      },
    }),
  ]);
});

afterAll(async () => {
  await prisma.wechatShippingIntent.deleteMany({
    where: { order_id: deliveryOrderId },
  });
  await prisma.adminCommandReceipt.deleteMany({
    where: {
      admin_user_id: { in: [ids.admin, `missing-${ids.admin}`] },
    },
  });
  await prisma.businessEventLog.deleteMany({
    where: { order_id: deliveryOrderId },
  });
  await prisma.adminAuditLog.deleteMany({
    where: { target_type: 'Order', target_id: deliveryOrderId },
  });
  await prisma.orderTimelineLog.deleteMany({
    where: { order_id: deliveryOrderId },
  });
  await prisma.order.deleteMany({
    where: { id: { in: [deliveryOrderId, pickupOrderId] } },
  });
  await prisma.pickupStore.delete({ where: { id: ids.store } });
  await prisma.community.delete({ where: { id: ids.community } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.adminUser.delete({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('L53-B admin delivery status executor on PostgreSQL', () => {
  it('persists pending -> delivering -> delivered without mutating the promise', async () => {
    const before = await prisma.order.findUniqueOrThrow({
      where: { id: deliveryOrderId },
    });

    const delivering = await executeAdminDeliveryStatusCommand(
      command('delivery-chain-0001'),
    );
    expect(delivering).toMatchObject({
      delivery_status: 'delivering',
      order_status: 'paid',
      version: 2,
      allowed_next_statuses: ['delivered', 'exception'],
    });

    const delivered = await executeAdminDeliveryStatusCommand(
      command('delivery-chain-0002', 'delivered', 2),
    );
    expect(delivered).toMatchObject({
      delivery_status: 'delivered',
      order_status: 'delivered',
      version: 3,
      allowed_next_statuses: [],
    });

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: deliveryOrderId },
    });
    expect(after.fulfillment_promise_snapshot).toEqual(
      before.fulfillment_promise_snapshot,
    );
    expect(after.promised_fulfillment_start_at).toEqual(
      before.promised_fulfillment_start_at,
    );
    await expect(
      prisma.wechatShippingIntent.findUnique({
        where: { order_id: deliveryOrderId },
      }),
    ).resolves.toMatchObject({
      trigger: 'delivery_started',
      logistics_type: 2,
      status: 'pending',
      attempt_count: 0,
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 2,
      audits: 2,
      timeline: 2,
    });
  });

  it('replays the same key without duplicate state or audit effects', async () => {
    const input = command('delivery-replay-001');
    const first = await executeAdminDeliveryStatusCommand(input);
    const replay = await executeAdminDeliveryStatusCommand(input);

    expect(replay).toEqual(first);
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 1,
      audits: 1,
      timeline: 1,
    });
    await expect(
      prisma.adminCommandReceipt.count({
        where: { admin_user_id: ids.admin },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.wechatShippingIntent.count({
        where: { order_id: deliveryOrderId },
      }),
    ).resolves.toBe(1);
  });

  it('rejects a reused key with a different transition digest', async () => {
    const key = 'delivery-reused-001';
    await executeAdminDeliveryStatusCommand(command(key));

    await expect(
      executeAdminDeliveryStatusCommand(
        command(key, 'exception', 1, '联系不上收货人'),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('rejects stale versions, pickup orders, and terminal delivery states', async () => {
    await expect(
      executeAdminDeliveryStatusCommand(
        command('delivery-stale-0001', 'delivering', 2),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_DELIVERY_VERSION_CONFLICT',
    });

    await expect(
      executeAdminDeliveryStatusCommand({
        ...command('delivery-pickup-001'),
        order_id: pickupOrderId,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_DELIVERY_TYPE_CONFLICT',
    });

    await prisma.order.update({
      where: { id: deliveryOrderId },
      data: { delivery_status: 'delivered' },
    });
    await expect(
      executeAdminDeliveryStatusCommand(
        command('delivery-terminal-01', 'exception', 1, '错误回退'),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_DELIVERY_TRANSITION_CONFLICT',
    });
  });

  it('records an exception reason and permits recovery', async () => {
    const exception = await executeAdminDeliveryStatusCommand(
      command(
        'delivery-exception-1',
        'exception',
        1,
        '联系不上收货人',
      ),
    );
    expect(exception.allowed_next_statuses).toEqual([
      'pending_dispatch',
      'delivering',
    ]);

    const recovered = await executeAdminDeliveryStatusCommand(
      command('delivery-recovery-01', 'pending_dispatch', 2),
    );
    expect(recovered).toMatchObject({
      delivery_status: 'pending_dispatch',
      version: 3,
    });
  });

  it('rolls back the order, logs, and receipt when audit persistence fails', async () => {
    const input = command('delivery-rollback-01');

    await expect(
      executeAdminDeliveryStatusCommand({
        ...input,
        context: {
          ...input.context,
          admin_user_id: `missing-${ids.admin}`,
        },
      }),
    ).rejects.toBeTruthy();

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: deliveryOrderId } }),
    ).resolves.toMatchObject({
      delivery_status: 'pending_dispatch',
      order_status: 'paid',
      version: 1,
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 0,
      audits: 0,
      timeline: 0,
    });
    await expect(
      prisma.adminCommandReceipt.count({
        where: { admin_user_id: `missing-${ids.admin}` },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.wechatShippingIntent.count({
        where: { order_id: deliveryOrderId },
      }),
    ).resolves.toBe(0);
  });

  it('uses a typed error surface', () => {
    const error = new AdminDeliveryStatusError(
      409,
      'ADMIN_DELIVERY_TRANSITION_CONFLICT',
      '状态冲突',
    );
    expect(error).toMatchObject({
      statusCode: 409,
      code: 'ADMIN_DELIVERY_TRANSITION_CONFLICT',
    });
  });
});
