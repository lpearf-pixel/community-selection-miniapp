import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import { executeAdminRefundCommand } from './admin-refund-executor.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `c2t3a-admin-${suffix}`,
  openid: `c2t3a-user-${suffix}`,
  community: `C2T3A community ${suffix}`,
  orderNo: `C2T3A-${suffix}`,
};
let userId = '';
let communityId = '';
let orderId = '';
let caseId = '';
const originalMock = process.env.MOCK_WECHAT_PAY;

const context = (allowed = true): AdminAccessContext => ({
  admin_user_id: ids.admin,
  role: allowed ? 'super_admin' : 'store_manager',
  permissions: allowed
    ? ['admin.full_access']
    : ['after_sale.manage', 'refund.manage'],
  is_super_admin: allowed,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: allowed,
    can_access_all_communities: allowed,
  },
  data_scope_source: allowed ? 'session' : 'header_mock',
});

function input(
  key: string,
  overrides: {
    expected_version?: number;
    admin_remark?: string;
    context?: AdminAccessContext;
  } = {},
) {
  return {
    after_sale_case_id: caseId,
    command: {
      expected_version: overrides.expected_version ?? 1,
      idempotency_key: key,
      admin_remark: overrides.admin_remark ?? '执行已审批部分退款',
    },
    context: overrides.context ?? context(),
    admin_meta: {
      ip_address: '127.0.0.1',
      user_agent: 'c2t3a-integration',
    },
  };
}

async function counts() {
  const [refunds, receipts, audits, events, timeline, afterSaleLogs] =
    await Promise.all([
      prisma.refund.count({ where: { order_id: orderId } }),
      prisma.adminCommandReceipt.count({
        where: { admin_user_id: ids.admin },
      }),
      prisma.adminAuditLog.count({
        where: { target_type: 'AfterSaleCase', target_id: caseId },
      }),
      prisma.businessEventLog.count({
        where: { order_id: orderId, event_type: 'admin_refund_executed' },
      }),
      prisma.orderTimelineLog.count({
        where: { order_id: orderId, event_type: 'admin_refund_executed' },
      }),
      prisma.afterSaleLog.count({
        where: {
          after_sale_case_id: caseId,
          action: 'after_sale_refund_executed',
        },
      }),
    ]);
  return { refunds, receipts, audits, events, timeline, afterSaleLogs };
}

beforeAll(async () => {
  process.env.MOCK_WECHAT_PAY = 'true';
  await prisma.adminUser.create({
    data: {
      id: ids.admin,
      username: ids.admin,
      password_hash: 'integration-only',
      status: 'active',
    },
  });
  const user = await prisma.user.create({
    data: {
      openid: ids.openid,
      nickname: 'C2 T3A integration',
      status: 'active',
    },
  });
  userId = user.id;
  const community = await prisma.community.create({
    data: {
      name: ids.community,
      address: 'C2 T3A integration address',
      status: 'active',
    },
  });
  communityId = community.id;
  const order = await prisma.order.create({
    data: {
      order_no: ids.orderNo,
      user_id: userId,
      community_id: communityId,
      total_amount_cents: 2_000,
      product_amount_cents: 1_800,
      delivery_fee_cents: 200,
      pay_amount_cents: 2_000,
      pay_status: 'paid',
      order_status: 'paid',
      pickup_type: 'delivery',
      receiver_name: 'C2 T3A',
      receiver_phone: '13800000000',
      version: 1,
    },
  });
  orderId = order.id;
  const afterSale = await prisma.afterSaleCase.create({
    data: {
      order_id: orderId,
      user_id: userId,
      type: 'refund',
      status: 'approved',
      resolution_type: 'partial_refund',
      reason: '集成测试退款',
      requested_refund_cents: 500,
      approved_refund_cents: 500,
      approved_product_refund_cents: 400,
      approved_delivery_refund_cents: 100,
      reviewed_by_admin_id: ids.admin,
      reviewed_at: new Date(),
    },
  });
  caseId = afterSale.id;
});

beforeEach(async () => {
  process.env.MOCK_WECHAT_PAY = 'true';
  await prisma.$transaction([
    prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: ids.admin },
    }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'AfterSaleCase', target_id: caseId },
    }),
    prisma.businessEventLog.deleteMany({ where: { order_id: orderId } }),
    prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } }),
    prisma.afterSaleLog.deleteMany({
      where: { after_sale_case_id: caseId },
    }),
    prisma.refund.deleteMany({ where: { order_id: orderId } }),
    prisma.afterSaleCase.update({
      where: { id: caseId },
      data: {
        status: 'approved',
        resolution_type: 'partial_refund',
        approved_refund_cents: 500,
        approved_product_refund_cents: 400,
        approved_delivery_refund_cents: 100,
        refund_id: null,
        resolved_by_admin_id: null,
        resolved_at: null,
      },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        version: 1,
        refund_amount_cents: 0,
        product_refund_amount_cents: 0,
        delivery_refund_amount_cents: 0,
        refund_status: 'none',
        order_status: 'paid',
      },
    }),
  ]);
});

afterAll(async () => {
  if (caseId) {
    await prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: ids.admin },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'AfterSaleCase', target_id: caseId },
    });
    await prisma.businessEventLog.deleteMany({ where: { order_id: orderId } });
    await prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } });
    await prisma.afterSaleLog.deleteMany({
      where: { after_sale_case_id: caseId },
    });
    await prisma.refund.deleteMany({ where: { order_id: orderId } });
    await prisma.afterSaleCase.deleteMany({ where: { id: caseId } });
  }
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.community.deleteMany({ where: { id: communityId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  if (originalMock === undefined) delete process.env.MOCK_WECHAT_PAY;
  else process.env.MOCK_WECHAT_PAY = originalMock;
  await prisma.$disconnect();
});

describe.sequential('Admin refund executor on PostgreSQL', () => {
  it('executes the approved split once and replays the stable result', async () => {
    const first = await executeAdminRefundCommand(
      input('admin-refund-success-0001'),
    );
    const replay = await executeAdminRefundCommand(
      input('admin-refund-success-0001'),
    );

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      after_sale_case_id: caseId,
      order_id: orderId,
      refund_status: 'success',
      refund_amount_cents: 500,
      product_refund_amount_cents: 400,
      delivery_refund_amount_cents: 100,
      remaining_refundable_amount_cents: 1_500,
      version: 2,
      execution_mode: 'mock',
    });
    await expect(counts()).resolves.toEqual({
      refunds: 1,
      receipts: 1,
      audits: 1,
      events: 1,
      timeline: 1,
      afterSaleLogs: 1,
    });
  });

  it('rejects same-key drift without another write', async () => {
    await executeAdminRefundCommand(input('admin-refund-reuse-00001'));
    await expect(
      executeAdminRefundCommand(
        input('admin-refund-reuse-00001', { admin_remark: '不同备注' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
    await expect(counts()).resolves.toMatchObject({ refunds: 1, receipts: 1 });
  });

  it('allows exactly one of two concurrent keys', async () => {
    const settled = await Promise.allSettled([
      executeAdminRefundCommand(input('admin-refund-race-000001')),
      executeAdminRefundCommand(input('admin-refund-race-000002')),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((item) => item.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ statusCode: 409 }),
    });
    await expect(counts()).resolves.toMatchObject({ refunds: 1, receipts: 1 });
  });

  it('rejects stale version and wrong scope with zero writes', async () => {
    await expect(
      executeAdminRefundCommand(
        input('admin-refund-stale-00001', { expected_version: 2 }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_ORDER_VERSION_CONFLICT',
    });
    await expect(
      executeAdminRefundCommand(
        input('admin-refund-scope-00001', { context: context(false) }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'ADMIN_FORBIDDEN' });
    await expect(counts()).resolves.toEqual({
      refunds: 0,
      receipts: 0,
      audits: 0,
      events: 0,
      timeline: 0,
      afterSaleLogs: 0,
    });
  });

  it('fails closed outside explicit MOCK mode with zero writes', async () => {
    process.env.MOCK_WECHAT_PAY = 'false';
    await expect(
      executeAdminRefundCommand(input('admin-refund-provider-001')),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'ADMIN_REFUND_PROVIDER_UNAVAILABLE',
    });
    await expect(counts()).resolves.toEqual({
      refunds: 0,
      receipts: 0,
      audits: 0,
      events: 0,
      timeline: 0,
      afterSaleLogs: 0,
    });
  });
});
