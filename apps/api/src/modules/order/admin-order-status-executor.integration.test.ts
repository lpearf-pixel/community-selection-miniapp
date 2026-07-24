import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  AdminOrderCommandError,
  executeAdminOrderStatusCommand,
} from './admin-order-status-executor.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `c2-admin-${suffix}`,
  userOpenid: `c2-user-${suffix}`,
  orderNo: `C2-${suffix}`,
};
let userId = '';
let orderId = '';

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

function command(
  idempotencyKey: string,
  nextStatus: 'ready' | 'picked' | 'completed' = 'ready',
) {
  return {
    order_id: orderId,
    command: {
      next_status: nextStatus,
      expected_version: 1,
      idempotency_key: idempotencyKey,
    },
    context: fullContext(),
    admin_meta: {},
  } as const;
}

async function sideEffectCounts() {
  const [events, audits, timeline] = await Promise.all([
    prisma.businessEventLog.count({ where: { order_id: orderId } }),
    prisma.adminAuditLog.count({
      where: { target_type: 'Order', target_id: orderId },
    }),
    prisma.orderTimelineLog.count({ where: { order_id: orderId } }),
  ]);
  return { events, audits, timeline };
}

async function resetOrder() {
  await prisma.$transaction([
    prisma.adminCommandReceipt.deleteMany({
      where: {
        OR: [
          { admin_user_id: ids.admin },
          { admin_user_id: `missing-${ids.admin}` },
        ],
      },
    }),
    prisma.businessEventLog.deleteMany({ where: { order_id: orderId } }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: orderId },
    }),
    prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        order_status: 'paid',
        version: 1,
        completed_at: null,
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
      nickname: 'C2 transaction test',
      role: 'customer',
      status: 'active',
    },
  });
  userId = user.id;
  const order = await prisma.order.create({
    data: {
      order_no: ids.orderNo,
      user_id: user.id,
      total_amount_cents: 100,
      product_amount_cents: 100,
      pay_amount_cents: 100,
      pay_status: 'paid',
      order_status: 'paid',
      receiver_name: 'C2 test',
      receiver_phone: '13800000000',
    },
  });
  orderId = order.id;
});

beforeEach(resetOrder);

afterAll(async () => {
  if (orderId) {
    await prisma.adminCommandReceipt.deleteMany({
      where: {
        OR: [
          { admin_user_id: ids.admin },
          { admin_user_id: `missing-${ids.admin}` },
        ],
      },
    });
    await prisma.businessEventLog.deleteMany({ where: { order_id: orderId } });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: orderId },
    });
    await prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('Admin order status executor on PostgreSQL', () => {
  it('allows only one different-key writer for the same expected version', async () => {
    const settled = await Promise.allSettled([
      executeAdminOrderStatusCommand(command('different-key-0001')),
      executeAdminOrderStatusCommand(command('different-key-0002', 'picked')),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(AdminOrderCommandError);
    expect(rejected?.reason.code).toBe('ADMIN_ORDER_VERSION_CONFLICT');
    await expect(prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .resolves.toMatchObject({ version: 2 });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 1,
      audits: 1,
      timeline: 1,
    });
  });

  it('replays the same key without duplicating side effects', async () => {
    const input = command('same-command-key-01');
    const first = await executeAdminOrderStatusCommand(input);
    const replay = await executeAdminOrderStatusCommand(input);

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
  });

  it('coalesces concurrent retries with the same key', async () => {
    const input = command('concurrent-same-key');
    const [first, second] = await Promise.all([
      executeAdminOrderStatusCommand(input),
      executeAdminOrderStatusCommand(input),
    ]);

    expect(second).toEqual(first);
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 1,
      audits: 1,
      timeline: 1,
    });
  });

  it('rejects the same key with a different command digest', async () => {
    const key = 'reused-command-key1';
    await executeAdminOrderStatusCommand(command(key));

    await expect(
      executeAdminOrderStatusCommand(command(key, 'picked')),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('reauthorizes current data scope before replay', async () => {
    const input = command('replay-scope-key-01');
    await executeAdminOrderStatusCommand(input);

    await expect(
      executeAdminOrderStatusCommand({
        ...input,
        context: noScopeContext(),
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_ORDER_SCOPE_FORBIDDEN',
    });
  });

  it('rolls back the order, logs and receipt when an audit side effect fails', async () => {
    const input = command('rollback-command-001', 'completed');

    await expect(
      executeAdminOrderStatusCommand({
        ...input,
        context: {
          ...input.context,
          admin_user_id: `missing-${ids.admin}`,
        },
      }),
    ).rejects.toBeTruthy();
    await expect(prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .resolves.toMatchObject({
        order_status: 'paid',
        version: 1,
        completed_at: null,
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
  });
});
