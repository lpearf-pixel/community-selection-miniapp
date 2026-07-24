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
  leaderOpenid: `c2-leader-${suffix}`,
  categoryName: `C2 category ${suffix}`,
  productName: `C2 product ${suffix}`,
  communityName: `C2 community ${suffix}`,
  orderNo: `C2-${suffix}`,
};
let userId = '';
let leaderId = '';
let categoryId = '';
let productId = '';
let communityId = '';
let groupBuyId = '';
let commissionId = '';
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
  nextStatus: 'ready' | 'completed' = 'ready',
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
    prisma.commission.update({
      where: { id: commissionId },
      data: { status: 'estimated', available_at: null },
    }),
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
  const leader = await prisma.user.create({
    data: {
      openid: ids.leaderOpenid,
      nickname: 'C2 reward leader',
      role: 'leader',
      status: 'active',
    },
  });
  leaderId = leader.id;
  const category = await prisma.category.create({
    data: { name: ids.categoryName },
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      name: ids.productName,
      category_id: category.id,
      price_cents: 100,
      cost_price_cents: 50,
      stock: 100,
      unit: '份',
      commission_type: 'fixed',
      commission_value: 10,
      status: 'active',
    },
  });
  productId = product.id;
  const community = await prisma.community.create({
    data: {
      name: ids.communityName,
      address: 'C2 integration address',
      status: 'active',
    },
  });
  communityId = community.id;
  const now = Date.now();
  const groupBuy = await prisma.groupBuy.create({
    data: {
      product_id: product.id,
      leader_user_id: leader.id,
      community_id: community.id,
      min_people: 1,
      min_quantity: 1,
      price_cents: 100,
      start_time: new Date(now - 60_000),
      end_time: new Date(now + 60_000),
      pickup_time: new Date(now + 120_000),
      status: 'success',
    },
  });
  groupBuyId = groupBuy.id;
  const order = await prisma.order.create({
    data: {
      order_no: ids.orderNo,
      user_id: user.id,
      group_buy_id: groupBuy.id,
      product_id: product.id,
      leader_user_id: leader.id,
      community_id: community.id,
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
  const commission = await prisma.commission.create({
    data: {
      leader_user_id: leader.id,
      order_id: order.id,
      group_buy_id: groupBuy.id,
      base_amount_cents: 100,
      commission_type: 'fixed',
      commission_value: 10,
      estimated_amount_cents: 10,
      final_amount_cents: 10,
      status: 'estimated',
    },
  });
  commissionId = commission.id;
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
    await prisma.commission.deleteMany({ where: { id: commissionId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
  }
  if (groupBuyId) await prisma.groupBuy.deleteMany({ where: { id: groupBuyId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (communityId) await prisma.community.deleteMany({ where: { id: communityId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  if (leaderId) await prisma.user.deleteMany({ where: { id: leaderId } });
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
      executeAdminOrderStatusCommand(command(key, 'completed')),
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

  it('moves a real completion commission once and replays without duplicate effects', async () => {
    const input = command('completion-reward-key', 'completed');
    const first = await executeAdminOrderStatusCommand(input);
    const replay = await executeAdminOrderStatusCommand(input);

    expect(replay).toEqual(first);
    await expect(
      prisma.commission.findUniqueOrThrow({ where: { id: commissionId } }),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 2,
      audits: 1,
      timeline: 2,
    });
    await expect(
      prisma.adminCommandReceipt.count({
        where: { admin_user_id: ids.admin },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back completion when strict reward event logging fails', async () => {
    const trigger = 'c2_fail_commission_pending_event';
    const failure = 'c2_raise_commission_pending_failure';
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${trigger} ON "BusinessEventLog"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${failure}()`);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${failure}() RETURNS trigger AS $c2$
       BEGIN
         IF NEW.event_type = 'commission_pending' THEN
           RAISE EXCEPTION 'forced commission pending event failure';
         END IF;
         RETURN NEW;
       END;
       $c2$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${trigger}
       BEFORE INSERT ON "BusinessEventLog"
       FOR EACH ROW EXECUTE FUNCTION ${failure}()`,
    );
    try {
      await expect(
        executeAdminOrderStatusCommand(
          command('reward-rollback-key', 'completed'),
        ),
      ).rejects.toBeTruthy();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${trigger} ON "BusinessEventLog"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${failure}()`);
    }

    await expect(prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .resolves.toMatchObject({
        order_status: 'paid',
        version: 1,
        completed_at: null,
      });
    await expect(
      prisma.commission.findUniqueOrThrow({ where: { id: commissionId } }),
    ).resolves.toMatchObject({ status: 'estimated', available_at: null });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 0,
      audits: 0,
      timeline: 0,
    });
    await expect(
      prisma.adminCommandReceipt.count({
        where: { admin_user_id: ids.admin },
      }),
    ).resolves.toBe(0);
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
