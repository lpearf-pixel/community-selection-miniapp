import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  AdminPickupVerificationError,
  executeAdminPickupVerificationCommand,
} from './admin-pickup-verification-executor.js';

const runSuffix = String(
  process.env.GITHUB_RUN_ID ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
const ids = {
  admin: `c2t2-admin-${runSuffix}`,
  userOpenid: `c2t2-user-${runSuffix}`,
  community: `c2t2-community-${runSuffix}`,
  pickupStore: `c2t2-store-${runSuffix}`,
  orderNo: `C2T2-${runSuffix}`,
};
let userId = '';
let communityId = '';
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
  permissions: ['pickup.verify'],
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
  overrides: {
    order_id?: string;
    expected_version?: number;
    admin_remark?: string | null;
    context?: AdminAccessContext;
  } = {},
) {
  return {
    order_id: overrides.order_id ?? orderId,
    command: {
      expected_version: overrides.expected_version ?? 1,
      idempotency_key: idempotencyKey,
      admin_remark:
        overrides.admin_remark === undefined
          ? '后台现场核销'
          : overrides.admin_remark,
    },
    context: overrides.context ?? fullContext(),
    admin_meta: {
      ip_address: '127.0.0.1',
      user_agent: 'c2t2-integration',
    },
  };
}

async function sideEffectCounts() {
  const [events, timeline, audits, receipts] = await Promise.all([
    prisma.businessEventLog.count({
      where: { order_id: orderId, event_type: 'pickup_verified' },
    }),
    prisma.orderTimelineLog.count({
      where: { order_id: orderId, event_type: 'pickup_verified' },
    }),
    prisma.adminAuditLog.count({
      where: {
        target_type: 'Order',
        target_id: orderId,
        action: 'order_pickup_verified',
      },
    }),
    prisma.adminCommandReceipt.count({
      where: { admin_user_id: ids.admin },
    }),
  ]);
  return { events, timeline, audits, receipts };
}

async function resetOrder() {
  await prisma.$transaction([
    prisma.wechatShippingIntent.deleteMany({
      where: { order_id: orderId },
    }),
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
      nickname: 'C2 T2 transaction test',
      role: 'customer',
      status: 'active',
    },
  });
  userId = user.id;
  const community = await prisma.community.create({
    data: {
      name: ids.community,
      address: 'C2 T2 integration address',
      status: 'active',
    },
  });
  communityId = community.id;
  await prisma.pickupStore.create({
    data: {
      id: ids.pickupStore,
      name: `C2 T2 store ${runSuffix}`,
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
      receiver_name: 'C2 T2 test',
      receiver_phone: '13800000000',
      version: 1,
    },
  });
  orderId = order.id;
});

beforeEach(resetOrder);

afterAll(async () => {
  if (orderId) {
    await prisma.wechatShippingIntent.deleteMany({
      where: { order_id: orderId },
    });
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
  await prisma.$disconnect();
});

describe.sequential('Admin pickup verification executor on PostgreSQL', () => {
  it('verifies one store-ready order with exactly one atomic effect set', async () => {
    const result = await executeAdminPickupVerificationCommand(
      command('pickup-success-key01'),
    );

    expect(result).toEqual({
      order_id: orderId,
      order_no: ids.orderNo,
      order_status: 'picked',
      version: 2,
    });
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toMatchObject({
      pickup_type: 'store',
      order_status: 'picked',
      version: 2,
      completed_at: null,
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 1,
      timeline: 1,
      audits: 1,
      receipts: 1,
    });
    await expect(
      prisma.adminCommandReceipt.findFirstOrThrow({
        where: { admin_user_id: ids.admin },
      }),
    ).resolves.toMatchObject({
      operation: 'admin.order.pickup.verify.v1',
      target_id: orderId,
      response_http_status: 200,
      response_code: 'ADMIN_PICKUP_VERIFIED',
      completed_at: expect.any(Date),
    });
    await expect(
      prisma.wechatShippingIntent.findUnique({
        where: { order_id: orderId },
      }),
    ).resolves.toMatchObject({
      trigger: 'pickup_verified',
      logistics_type: 4,
      status: 'pending',
      attempt_count: 0,
    });
  });

  it('rejects a delivery-ready order with zero side effects', async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: { pickup_type: 'delivery' },
    });

    await expect(
      executeAdminPickupVerificationCommand(command('pickup-delivery-key')),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_PICKUP_TYPE_CONFLICT',
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 0,
      timeline: 0,
      audits: 0,
      receipts: 0,
    });
  });

  it('rejects a store order outside ready with zero side effects', async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: { order_status: 'preparing' },
    });

    await expect(
      executeAdminPickupVerificationCommand(command('pickup-state-key001')),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_PICKUP_STATE_CONFLICT',
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 0,
      timeline: 0,
      audits: 0,
      receipts: 0,
    });
  });

  it('rejects stale version and missing order with zero side effects', async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: { version: 2 },
    });
    await expect(
      executeAdminPickupVerificationCommand(command('pickup-stale-key001')),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_ORDER_VERSION_CONFLICT',
    });
    await expect(
      executeAdminPickupVerificationCommand(
        command('pickup-missing-key01', {
          order_id: `missing-${runSuffix}`,
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ADMIN_ORDER_NOT_FOUND',
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 0,
      timeline: 0,
      audits: 0,
      receipts: 0,
    });
  });

  it('rejects current data-scope loss with zero side effects', async () => {
    await expect(
      executeAdminPickupVerificationCommand(
        command('pickup-scope-key001', { context: noScopeContext() }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_FORBIDDEN',
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 0,
      timeline: 0,
      audits: 0,
      receipts: 0,
    });
  });

  it('allows one different-key writer for the same expected version', async () => {
    const settled = await Promise.allSettled([
      executeAdminPickupVerificationCommand(command('pickup-race-key0001')),
      executeAdminPickupVerificationCommand(command('pickup-race-key0002')),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(AdminPickupVerificationError);
    expect(rejected?.reason.code).toBe('ADMIN_PICKUP_STATE_CONFLICT');
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 1,
      timeline: 1,
      audits: 1,
      receipts: 1,
    });
    await expect(
      prisma.wechatShippingIntent.count({ where: { order_id: orderId } }),
    ).resolves.toBe(1);
  });

  it('coalesces same-key concurrency and replays without duplicates', async () => {
    const input = command('pickup-replay-key01');
    const [first, second] = await Promise.all([
      executeAdminPickupVerificationCommand(input),
      executeAdminPickupVerificationCommand(input),
    ]);
    const replay = await executeAdminPickupVerificationCommand(input);

    expect(second).toEqual(first);
    expect(replay).toEqual(first);
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 1,
      timeline: 1,
      audits: 1,
      receipts: 1,
    });
  });

  it('rejects key reuse for a different remark', async () => {
    const key = 'pickup-reused-key01';
    await executeAdminPickupVerificationCommand(
      command(key, { admin_remark: '第一次核销' }),
    );

    await expect(
      executeAdminPickupVerificationCommand(
        command(key, { admin_remark: '不同核销说明' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('reauthorizes current data scope before replay', async () => {
    const input = command('pickup-replay-scope1');
    await executeAdminPickupVerificationCommand(input);

    await expect(
      executeAdminPickupVerificationCommand({
        ...input,
        context: noScopeContext(),
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_FORBIDDEN',
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 1,
      timeline: 1,
      audits: 1,
      receipts: 1,
    });
  });

  it.each([
    {
      label: 'business event',
      table: 'BusinessEventLog',
      when: `NEW.event_type = 'pickup_verified'`,
    },
    {
      label: 'timeline',
      table: 'OrderTimelineLog',
      when: `NEW.event_type = 'pickup_verified'`,
    },
    {
      label: 'Admin audit',
      table: 'AdminAuditLog',
      when: `NEW.action = 'order_pickup_verified'`,
    },
    {
      label: 'receipt completion',
      table: 'AdminCommandReceipt',
      when: `NEW.response_code = 'ADMIN_PICKUP_VERIFIED'`,
      timing: 'UPDATE',
    },
  ])('rolls back every write when $label fails', async ({ table, when, timing }) => {
    const token = `c2t2_${process.pid}_${Date.now()}`;
    const functionName = `${token}_failure`;
    const triggerName = `${token}_trigger`;
    const operation = timing ?? 'INSERT';
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${functionName}"() RETURNS trigger AS $c2t2$
       BEGIN
         IF ${when} THEN
           RAISE EXCEPTION 'forced C2 T2 atomic failure';
         END IF;
         RETURN NEW;
       END;
       $c2t2$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${triggerName}"
       BEFORE ${operation} ON "${table}"
       FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
    );
    try {
      await expect(
        executeAdminPickupVerificationCommand(
          command(`rollback-${table}-key`.slice(0, 40).padEnd(16, 'x')),
        ),
      ).rejects.toBeTruthy();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "${table}"`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS "${functionName}"()`,
      );
    }

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toMatchObject({
      order_status: 'ready',
      version: 1,
      completed_at: null,
    });
    await expect(sideEffectCounts()).resolves.toEqual({
      events: 0,
      timeline: 0,
      audits: 0,
      receipts: 0,
    });
    await expect(
      prisma.wechatShippingIntent.count({ where: { order_id: orderId } }),
    ).resolves.toBe(0);
  });
});
