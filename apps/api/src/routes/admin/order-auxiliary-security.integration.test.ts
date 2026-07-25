import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminId = `aux-security-admin-${suffix}`;
const openid = `aux-security-user-${suffix}`;
const inScopeOrderNo = `AUX-IN-${suffix}`;
const outOfScopeOrderNo = `AUX-OUT-${suffix}`;
let userId = '';
let inScopeCommunityId = '';
let outOfScopeCommunityId = '';
let inScopeOrderId = '';
let outOfScopeOrderId = '';
const app = buildApp();

function headers(role: string, communityId?: string) {
  return {
    'x-admin-user-id': adminId,
    'x-admin-role': role,
    ...(communityId ? { 'x-admin-community-id': communityId } : {}),
  };
}

async function mutationSnapshot(orderId: string) {
  const [order, businessEvents, audits, timeline] = await Promise.all([
    prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { order_status: true, version: true },
    }),
    prisma.businessEventLog.count({ where: { order_id: orderId } }),
    prisma.adminAuditLog.count({
      where: { target_type: 'Order', target_id: orderId },
    }),
    prisma.orderTimelineLog.count({ where: { order_id: orderId } }),
  ]);
  return { order, businessEvents, audits, timeline };
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
      nickname: 'auxiliary security test',
      role: 'customer',
      status: 'active',
    },
  });
  userId = user.id;
  const [inScopeCommunity, outOfScopeCommunity] = await Promise.all([
    prisma.community.create({
      data: {
        name: `Aux in scope ${suffix}`,
        address: '测试路 201 号',
        status: 'active',
      },
    }),
    prisma.community.create({
      data: {
        name: `Aux out of scope ${suffix}`,
        address: '测试路 202 号',
        status: 'active',
      },
    }),
  ]);
  inScopeCommunityId = inScopeCommunity.id;
  outOfScopeCommunityId = outOfScopeCommunity.id;
  const [inScopeOrder, outOfScopeOrder] = await Promise.all([
    prisma.order.create({
      data: {
        order_no: inScopeOrderNo,
        user_id: user.id,
        community_id: inScopeCommunity.id,
        total_amount_cents: 100,
        product_amount_cents: 100,
        pay_amount_cents: 100,
        pay_status: 'paid',
        order_status: 'ready',
        receiver_name: 'scope test',
        receiver_phone: '13800000001',
      },
    }),
    prisma.order.create({
      data: {
        order_no: outOfScopeOrderNo,
        user_id: user.id,
        community_id: outOfScopeCommunity.id,
        total_amount_cents: 200,
        product_amount_cents: 200,
        pay_amount_cents: 200,
        pay_status: 'paid',
        order_status: 'ready',
        receiver_name: 'scope test',
        receiver_phone: '13800000002',
      },
    }),
  ]);
  inScopeOrderId = inScopeOrder.id;
  outOfScopeOrderId = outOfScopeOrder.id;
});

afterAll(async () => {
  const orderIds = [inScopeOrderId, outOfScopeOrderId].filter(Boolean);
  if (orderIds.length) {
    await prisma.businessEventLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: { in: orderIds } },
    });
    await prisma.orderTimelineLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  const communityIds = [
    inScopeCommunityId,
    outOfScopeCommunityId,
  ].filter(Boolean);
  if (communityIds.length) {
    await prisma.community.deleteMany({ where: { id: { in: communityIds } } });
  }
  await prisma.adminUser.deleteMany({ where: { id: adminId } });
  await app.close();
  await prisma.$disconnect();
});

describe.sequential('Admin order export and pickup data scope', () => {
  it('returns 403 when export scope is empty', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orders/export/picking.csv?format=detail',
      headers: headers('store_manager'),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: expect.stringContaining('ADMIN_SCOPE_FORBIDDEN'),
    });
  });

  it('exports only in-scope orders', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orders/export/picking.csv?format=detail',
      headers: headers('store_manager', inScopeCommunityId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain(inScopeOrderNo);
    expect(response.body).not.toContain(outOfScopeOrderNo);
  });

  it('rejects pickup without permission and preserves order side effects', async () => {
    const before = await mutationSnapshot(inScopeOrderId);
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${inScopeOrderId}/pickup-verify`,
      headers: headers('operator', inScopeCommunityId),
      payload: {
        expected_version: 1,
        idempotency_key: 'aux-pickup-permission',
        admin_remark: 'must not commit',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(await mutationSnapshot(inScopeOrderId)).toEqual(before);
  });

  it('rejects out-of-scope pickup and preserves order side effects', async () => {
    const before = await mutationSnapshot(inScopeOrderId);
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${inScopeOrderId}/pickup-verify`,
      headers: headers('store_manager', outOfScopeCommunityId),
      payload: {
        expected_version: 1,
        idempotency_key: 'aux-pickup-scope-01',
        admin_remark: 'must not commit',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'ADMIN_FORBIDDEN',
      trace_id: expect.any(String),
    });
    expect(await mutationSnapshot(inScopeOrderId)).toEqual(before);
  });
});
