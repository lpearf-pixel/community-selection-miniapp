import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';

const runSuffix = String(
  process.env.GITHUB_RUN_ID ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
const ids = {
  admin: `c2t2-route-admin-${runSuffix}`,
  userOpenid: `c2t2-route-user-${runSuffix}`,
  community: `c2t2-route-community-${runSuffix}`,
  pickupStore: `c2t2-route-store-${runSuffix}`,
  orderNo: `C2T2-ROUTE-${runSuffix}`,
};
let userId = '';
let communityId = '';
let orderId = '';
const app = buildApp();

const command = {
  expected_version: 1,
  idempotency_key: 'route-pickup-key01',
  admin_remark: '后台现场核销',
};

function headers(role: string) {
  return {
    'x-admin-user-id': ids.admin,
    'x-admin-role': role,
  };
}

async function reset() {
  await prisma.$transaction([
    prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: ids.admin },
    }),
    prisma.businessEventLog.deleteMany({ where: { order_id: orderId } }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: orderId },
    }),
    prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        pickup_type: 'store',
        pickup_store_id: ids.pickupStore,
        community_id: communityId,
        pay_status: 'paid',
        order_status: 'ready',
        version: 1,
        completed_at: null,
      },
    }),
  ]);
}

beforeAll(async () => {
  await app.ready();
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
      nickname: 'C2 T2 route test',
      role: 'customer',
      status: 'active',
    },
  });
  userId = user.id;
  const community = await prisma.community.create({
    data: {
      name: ids.community,
      address: 'C2 T2 route address',
      status: 'active',
    },
  });
  communityId = community.id;
  await prisma.pickupStore.create({
    data: {
      id: ids.pickupStore,
      name: `C2 T2 route store ${runSuffix}`,
      address: 'C2 T2 pickup address',
      phone: '021-88886666',
      status: 'active',
    },
  });
  const order = await prisma.order.create({
    data: {
      order_no: ids.orderNo,
      user_id: user.id,
      community_id: community.id,
      pickup_store_id: ids.pickupStore,
      pickup_type: 'store',
      total_amount_cents: 100,
      product_amount_cents: 100,
      pay_amount_cents: 100,
      pay_status: 'paid',
      order_status: 'ready',
      receiver_name: 'C2 T2 route test',
      receiver_phone: '13800000000',
      version: 1,
    },
  });
  orderId = order.id;
});

beforeEach(reset);

afterAll(async () => {
  if (orderId) {
    await prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: ids.admin },
    });
    await prisma.businessEventLog.deleteMany({ where: { order_id: orderId } });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: orderId },
    });
    await prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
  }
  await prisma.pickupStore.deleteMany({ where: { id: ids.pickupStore } });
  if (communityId) {
    await prisma.community.deleteMany({ where: { id: communityId } });
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await app.close();
  await prisma.$disconnect();
});

describe.sequential('POST /api/admin/orders/:id/pickup-verify', () => {
  it('retires the legacy pickup workbench mutation with zero side effects', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/pickup/orders/${orderId}/verify`,
      headers: headers('super_admin'),
      payload: {
        pickup_code: `PICK-${ids.orderNo.slice(-6).toUpperCase()}`,
        remark: 'legacy bypass',
      },
    });

    expect(response.statusCode).toBe(404);
    const [order, receipts, events, timeline, audits] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.adminCommandReceipt.count({
        where: { admin_user_id: ids.admin },
      }),
      prisma.businessEventLog.count({ where: { order_id: orderId } }),
      prisma.orderTimelineLog.count({ where: { order_id: orderId } }),
      prisma.adminAuditLog.count({
        where: { target_type: 'Order', target_id: orderId },
      }),
    ]);
    expect(order).toMatchObject({
      order_status: 'ready',
      version: 1,
    });
    expect([receipts, events, timeline, audits]).toEqual([0, 0, 0, 0]);
  });

  it('returns a traceable V1 401 without Admin identity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      payload: command,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      code: 'ADMIN_UNAUTHORIZED',
      message: '管理员身份无效',
      trace_id: expect.any(String),
    });
  });

  it('wraps malformed JSON and invalid commands in V1 400 envelopes', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: {
        ...headers('super_admin'),
        'content-type': 'application/json',
      },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({
      success: false,
      data: null,
      code: 'INVALID_ADMIN_PICKUP_VERIFY_COMMAND',
      message: '自提核销命令不合法',
      trace_id: expect.any(String),
    });

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: headers('super_admin'),
      payload: { ...command, expected_version: 0 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      success: false,
      code: 'INVALID_ADMIN_PICKUP_VERIFY_COMMAND',
      trace_id: expect.any(String),
    });
  });

  it('returns V1 403 for missing permission and current data scope', async () => {
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: headers('operator'),
      payload: command,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({
      code: 'ADMIN_FORBIDDEN',
      trace_id: expect.any(String),
    });

    const scoped = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: headers('store_manager'),
      payload: command,
    });
    expect(scoped.statusCode).toBe(403);
    expect(scoped.json()).toMatchObject({
      code: 'ADMIN_FORBIDDEN',
      trace_id: expect.any(String),
    });
  });

  it('returns 404 for a missing order', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/missing-${runSuffix}/pickup-verify`,
      headers: headers('super_admin'),
      payload: command,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'ADMIN_ORDER_NOT_FOUND',
      trace_id: expect.any(String),
    });
  });

  it('returns the versioned V1 success envelope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: headers('super_admin'),
      payload: command,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        order_id: orderId,
        order_no: ids.orderNo,
        order_status: 'picked',
        version: 2,
      },
      code: 'ADMIN_PICKUP_VERIFIED',
      message: '自提核销成功',
      trace_id: expect.any(String),
    });
  });

  it.each([
    {
      label: 'delivery type',
      update: { pickup_type: 'delivery' as const },
      code: 'ADMIN_PICKUP_TYPE_CONFLICT',
    },
    {
      label: 'non-ready state',
      update: { order_status: 'preparing' as const },
      code: 'ADMIN_PICKUP_STATE_CONFLICT',
    },
    {
      label: 'stale version',
      update: { version: 2 },
      code: 'ADMIN_ORDER_VERSION_CONFLICT',
    },
  ])('returns 409 for $label without side effects', async ({ update, code }) => {
    await prisma.order.update({
      where: { id: orderId },
      data: update,
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: headers('super_admin'),
      payload: command,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code,
      trace_id: expect.any(String),
    });
    await expect(
      prisma.businessEventLog.count({ where: { order_id: orderId } }),
    ).resolves.toBe(0);
  });

  it('returns 409 when the same key is reused for a different command', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: headers('super_admin'),
      payload: command,
    });
    expect(first.statusCode).toBe(200);

    const reused = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/pickup-verify`,
      headers: headers('super_admin'),
      payload: { ...command, admin_remark: '不同核销说明' },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
      trace_id: expect.any(String),
    });
  });

  it('rejects generic picked status commands with zero side effects', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/status`,
      headers: headers('super_admin'),
      payload: {
        next_status: 'picked',
        expected_version: 1,
        idempotency_key: 'generic-picked-key01',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'INVALID_ADMIN_ORDER_STATUS_COMMAND',
      trace_id: expect.any(String),
    });
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toMatchObject({ order_status: 'ready', version: 1 });
  });

  it('sanitizes unexpected database failures', async () => {
    const lookup = vi
      .spyOn(prisma.adminCommandReceipt, 'findUnique')
      .mockRejectedValueOnce(new Error('sensitive pickup database detail'));
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/orders/${orderId}/pickup-verify`,
        headers: headers('super_admin'),
        payload: command,
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        data: null,
        code: 'ADMIN_PICKUP_VERIFY_FAILED',
        message: '自提核销失败',
        trace_id: expect.any(String),
      });
      expect(response.body).not.toContain('sensitive pickup database detail');
    } finally {
      lookup.mockRestore();
    }
  });
});
