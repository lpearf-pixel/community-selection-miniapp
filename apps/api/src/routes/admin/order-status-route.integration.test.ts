import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminId = `route-admin-${suffix}`;
const openid = `route-user-${suffix}`;
const orderNo = `ROUTE-C2-${suffix}`;
let orderId = '';
let userId = '';
const app = buildApp();

const command = {
  next_status: 'ready',
  expected_version: 1,
  idempotency_key: 'route-command-key01',
};

function headers(role: string) {
  return {
    'x-admin-user-id': adminId,
    'x-admin-role': role,
  };
}

async function reset() {
  await prisma.$transaction([
    prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: adminId },
    }),
    prisma.businessEventLog.deleteMany({ where: { order_id: orderId } }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: orderId },
    }),
    prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } }),
    prisma.order.update({
      where: { id: orderId },
      data: { order_status: 'paid', version: 1, completed_at: null },
    }),
  ]);
}

beforeAll(async () => {
  await app.ready();
  await prisma.adminUser.create({
    data: {
      id: adminId,
      username: adminId,
      password_hash: 'integration-only',
      role: 'admin',
      status: 'active',
    },
  });
  const user = await prisma.user.create({
    data: {
      openid,
      nickname: 'route test',
      role: 'customer',
      status: 'active',
    },
  });
  userId = user.id;
  const order = await prisma.order.create({
    data: {
      order_no: orderNo,
      user_id: user.id,
      total_amount_cents: 100,
      product_amount_cents: 100,
      pay_amount_cents: 100,
      pay_status: 'paid',
      order_status: 'paid',
      receiver_name: 'route test',
      receiver_phone: '13800000000',
    },
  });
  orderId = order.id;
});

beforeEach(reset);

afterAll(async () => {
  if (orderId) {
    await prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: adminId },
    });
    await prisma.businessEventLog.deleteMany({ where: { order_id: orderId } });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: orderId },
    });
    await prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.adminUser.deleteMany({ where: { id: adminId } });
  await app.close();
  await prisma.$disconnect();
});

describe.sequential('POST /api/admin/orders/:id/status', () => {
  it('returns a traceable V1 401 without Admin identity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/status`,
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

  it('returns V1 403 for missing permission and current data scope', async () => {
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/status`,
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
      url: `/api/admin/orders/${orderId}/status`,
      headers: headers('store_manager'),
      payload: command,
    });
    expect(scoped.statusCode).toBe(403);
    expect(scoped.json()).toMatchObject({
      code: 'ADMIN_ORDER_SCOPE_FORBIDDEN',
      trace_id: expect.any(String),
    });
  });

  it('validates the body and returns the versioned result', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/status`,
      headers: headers('super_admin'),
      payload: { ...command, expected_version: 0 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: 'INVALID_ADMIN_ORDER_STATUS_COMMAND',
      trace_id: expect.any(String),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/status`,
      headers: headers('super_admin'),
      payload: command,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        order_id: orderId,
        order_no: orderNo,
        order_status: 'ready',
        version: 2,
        completed_at: null,
      },
      code: 'ADMIN_ORDER_STATUS_UPDATED',
      message: '',
      trace_id: expect.any(String),
    });
  });

  it('returns 409 for a stale expected version without a second side effect', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/status`,
      headers: headers('super_admin'),
      payload: command,
    });
    expect(first.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${orderId}/status`,
      headers: headers('super_admin'),
      payload: {
        ...command,
        next_status: 'picked',
        idempotency_key: 'route-command-key02',
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'ADMIN_ORDER_VERSION_CONFLICT',
      trace_id: expect.any(String),
    });
    await expect(
      prisma.businessEventLog.count({ where: { order_id: orderId } }),
    ).resolves.toBe(1);
  });
});
