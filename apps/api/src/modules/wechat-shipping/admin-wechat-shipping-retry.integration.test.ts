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
  executeAdminWechatShippingRetry,
} from './admin-wechat-shipping-retry.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `l53d1-admin-${suffix}`,
  userOpenid: `l53d1-user-${suffix}`,
  community: `l53d1-community-${suffix}`,
  store: `l53d1-store-${suffix}`,
  orderNo: `L53D1-${suffix}`,
};
let userId = '';
let orderId = '';
let intentId = '';

const fullContext = (): AdminAccessContext => ({
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

const noScopeContext = (): AdminAccessContext => ({
  ...fullContext(),
  role: 'store_manager',
  permissions: ['order.manage'],
  is_super_admin: false,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: false,
    can_access_all_communities: false,
  },
  data_scope_source: 'header_mock',
});

async function resetIntent() {
  await prisma.$transaction([
    prisma.businessEventLog.deleteMany({
      where: {
        order_id: orderId,
        event_type: 'wechat_shipping_retry_requested',
      },
    }),
    prisma.adminAuditLog.deleteMany({
      where: {
        target_type: 'WechatShippingIntent',
        target_id: intentId,
      },
    }),
    prisma.wechatShippingIntent.update({
      where: { id: intentId },
      data: {
        status: 'retryable',
        attempt_count: 2,
        last_error_code: 'WECHAT_SHIPPING_HTTP_503',
        next_retry_at: new Date('2026-07-29T12:02:00.000Z'),
      },
    }),
  ]);
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
      nickname: 'L53 D1 retry user',
    },
  });
  userId = user.id;
  await prisma.community.create({
    data: {
      id: ids.community,
      name: ids.community,
      address: '测试社区',
    },
  });
  await prisma.pickupStore.create({
    data: {
      id: ids.store,
      name: ids.store,
      address: '测试门店',
      phone: '02588888888',
    },
  });
  const order = await prisma.order.create({
    data: {
      order_no: ids.orderNo,
      user_id: user.id,
      community_id: ids.community,
      pickup_store_id: ids.store,
      pickup_type: 'delivery',
      total_amount_cents: 1_000,
      product_amount_cents: 1_000,
      pay_amount_cents: 1_000,
      pay_status: 'paid',
      order_status: 'paid',
      delivery_status: 'delivering',
      receiver_name: '测试用户',
      receiver_phone: '13800000000',
      receiver_address: '测试地址',
    },
  });
  orderId = order.id;
  const intent = await prisma.wechatShippingIntent.create({
    data: {
      order_id: order.id,
      trigger: 'delivery_started',
      logistics_type: 2,
      status: 'retryable',
      attempt_count: 2,
      last_error_code: 'WECHAT_SHIPPING_HTTP_503',
      next_retry_at: new Date('2026-07-29T12:02:00.000Z'),
    },
  });
  intentId = intent.id;
});

beforeEach(resetIntent);

afterAll(async () => {
  await prisma.businessEventLog.deleteMany({ where: { order_id: orderId } });
  await prisma.adminAuditLog.deleteMany({
    where: {
      target_type: 'WechatShippingIntent',
      target_id: intentId,
    },
  });
  await prisma.wechatShippingIntent.deleteMany({
    where: { order_id: orderId },
  });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.pickupStore.deleteMany({ where: { id: ids.store } });
  await prisma.community.deleteMany({ where: { id: ids.community } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('Admin WeChat shipping retry on PostgreSQL', () => {
  it('requeues the existing intent with one atomic audit set', async () => {
    await expect(
      executeAdminWechatShippingRetry({
        orderId,
        context: fullContext(),
        adminMeta: {},
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      attempts: 2,
      last_error_code: null,
      next_retry_at: null,
    });
    await expect(
      prisma.businessEventLog.count({
        where: {
          order_id: orderId,
          event_type: 'wechat_shipping_retry_requested',
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.adminAuditLog.count({
        where: {
          target_type: 'WechatShippingIntent',
          target_id: intentId,
          action: 'wechat_shipping_retry_requested',
        },
      }),
    ).resolves.toBe(1);
  });

  it('rejects success and current data-scope loss', async () => {
    await prisma.wechatShippingIntent.update({
      where: { id: intentId },
      data: { status: 'succeeded' },
    });
    await expect(
      executeAdminWechatShippingRetry({
        orderId,
        context: fullContext(),
        adminMeta: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_WECHAT_SHIPPING_STATE_CONFLICT',
    });

    await resetIntent();
    await expect(
      executeAdminWechatShippingRetry({
        orderId,
        context: noScopeContext(),
        adminMeta: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_WECHAT_SHIPPING_FORBIDDEN',
    });
  });

  it('rolls back the queue change when Admin audit persistence fails', async () => {
    await expect(
      executeAdminWechatShippingRetry({
        orderId,
        context: {
          ...fullContext(),
          admin_user_id: `missing-${ids.admin}`,
        },
        adminMeta: {},
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.wechatShippingIntent.findUniqueOrThrow({
        where: { id: intentId },
      }),
    ).resolves.toMatchObject({
      status: 'retryable',
      last_error_code: 'WECHAT_SHIPPING_HTTP_503',
    });
    await expect(
      prisma.businessEventLog.count({
        where: {
          order_id: orderId,
          event_type: 'wechat_shipping_retry_requested',
        },
      }),
    ).resolves.toBe(0);
  });
});
