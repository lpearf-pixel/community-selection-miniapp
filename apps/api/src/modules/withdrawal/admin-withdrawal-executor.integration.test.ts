import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import { appendRewardLedgerEntry } from '../../services/commission-service.js';
import { executeAdminWithdrawalCommand } from './admin-withdrawal-executor.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `c2t3b-admin-${suffix}`,
  leaderOpenid: `c2t3b-leader-${suffix}`,
  customerOpenid: `c2t3b-customer-${suffix}`,
  category: `C2T3B category ${suffix}`,
  product: `C2T3B product ${suffix}`,
  community: `C2T3B community ${suffix}`,
  orderNo: `C2T3B-${suffix}`,
};

let leaderId = '';
let customerId = '';
let categoryId = '';
let productId = '';
let communityId = '';
let groupBuyId = '';
let orderId = '';
let withdrawalId = '';
let commissionId = '';

const context = (allowed = true): AdminAccessContext => ({
  admin_user_id: ids.admin,
  role: allowed ? 'super_admin' : 'finance',
  permissions: ['withdrawal.manage'],
  is_super_admin: allowed,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: allowed,
    can_access_all_communities: allowed,
  },
  data_scope_source: 'session',
});

function input(
  action: 'approve' | 'reject' | 'mark-paid',
  key: string,
  overrides: {
    expectedVersion?: number;
    adminContext?: AdminAccessContext;
    withdrawalId?: string;
  } = {},
) {
  return {
    withdrawal_id: overrides.withdrawalId ?? withdrawalId,
    action,
    command: {
      expected_version: overrides.expectedVersion ?? 1,
      idempotency_key: key,
      admin_remark: `C2 T3B ${action}`,
      ...(action === 'mark-paid'
        ? { manual_reference: `manual-${suffix}` }
        : {}),
    },
    context: overrides.adminContext ?? context(),
    admin_meta: {
      ip_address: '127.0.0.1',
      user_agent: 'c2t3b-integration',
    },
  };
}

async function commandWriteCounts() {
  const [receipts, audits, events, timelines] = await Promise.all([
    prisma.adminCommandReceipt.count({
      where: { admin_user_id: ids.admin },
    }),
    prisma.adminAuditLog.count({
      where: { target_type: 'Withdrawal', target_id: withdrawalId },
    }),
    prisma.businessEventLog.count({ where: { withdrawal_id: withdrawalId } }),
    prisma.orderTimelineLog.count({ where: { order_id: orderId } }),
  ]);
  return { receipts, audits, events, timelines };
}

beforeAll(async () => {
  await prisma.adminUser.create({
    data: {
      id: ids.admin,
      username: ids.admin,
      password_hash: 'integration-only',
      status: 'active',
    },
  });
  const leader = await prisma.user.create({
    data: {
      openid: ids.leaderOpenid,
      nickname: 'C2 T3B leader',
      role: 'leader',
    },
  });
  leaderId = leader.id;
  const customer = await prisma.user.create({
    data: {
      openid: ids.customerOpenid,
      nickname: 'C2 T3B customer',
      role: 'customer',
    },
  });
  customerId = customer.id;
  const category = await prisma.category.create({
    data: { name: ids.category },
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      name: ids.product,
      category_id: categoryId,
      price_cents: 1_000,
      cost_price_cents: 500,
      stock: 10,
      unit: '份',
      stock_unit: '份',
      sale_unit: '份',
      status: 'active',
      is_group_enabled: true,
    },
  });
  productId = product.id;
  const community = await prisma.community.create({
    data: {
      name: ids.community,
      address: 'C2 T3B integration address',
    },
  });
  communityId = community.id;
  const groupBuy = await prisma.groupBuy.create({
    data: {
      product_id: productId,
      leader_user_id: leaderId,
      community_id: communityId,
      min_people: 1,
      min_quantity: 1,
      current_people: 1,
      current_quantity: 1,
      price_cents: 1_000,
      start_time: new Date(Date.now() - 3_600_000),
      end_time: new Date(Date.now() + 3_600_000),
      pickup_time: new Date(Date.now() + 86_400_000),
      status: 'success',
    },
  });
  groupBuyId = groupBuy.id;
  const order = await prisma.order.create({
    data: {
      order_no: ids.orderNo,
      user_id: customerId,
      group_buy_id: groupBuyId,
      product_id: productId,
      leader_user_id: leaderId,
      community_id: communityId,
      total_amount_cents: 1_000,
      product_amount_cents: 1_000,
      pay_amount_cents: 1_000,
      pay_status: 'paid',
      order_status: 'completed',
      receiver_name: 'C2 T3B',
      receiver_phone: '13800000000',
    },
  });
  orderId = order.id;
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: ids.admin },
    }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Withdrawal', target_id: withdrawalId || '-' },
    }),
    prisma.businessEventLog.deleteMany({ where: { order_id: orderId } }),
    prisma.businessEventLog.deleteMany({
      where: { withdrawal_id: withdrawalId || '-' },
    }),
    prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } }),
    prisma.rewardLedger.deleteMany({ where: { leader_user_id: leaderId } }),
    prisma.withdrawalCommission.deleteMany({
      where: { withdrawal_id: withdrawalId || '-' },
    }),
    prisma.commission.deleteMany({ where: { order_id: orderId } }),
    prisma.withdrawal.deleteMany({ where: { id: withdrawalId || '-' } }),
  ]);
  const withdrawal = await prisma.withdrawal.create({
    data: {
      leader_user_id: leaderId,
      amount_cents: 500,
      taxable_amount_cents: 500,
      payable_amount_cents: 500,
    },
  });
  withdrawalId = withdrawal.id;
  const commission = await prisma.commission.create({
    data: {
      leader_user_id: leaderId,
      order_id: orderId,
      group_buy_id: groupBuyId,
      withdrawal_id: withdrawalId,
      base_amount_cents: 1_000,
      commission_type: 'fixed',
      commission_value: 500,
      estimated_amount_cents: 500,
      final_amount_cents: 500,
      status: 'withdrawing',
      available_at: new Date(),
      review_status: 'approved',
    },
  });
  commissionId = commission.id;
  await prisma.withdrawalCommission.create({
    data: {
      withdrawal_id: withdrawalId,
      commission_id: commissionId,
      amount_cents: 500,
    },
  });
  await prisma.rewardLedger.createMany({
    data: [
      {
        leader_user_id: leaderId,
        commission_id: commissionId,
        order_id: orderId,
        idempotency_key: `available-${withdrawalId}`,
        event_type: 'commission_available',
        entry_type: 'commission_available',
        direction: 'in',
        amount_cents: 500,
        affects_available_balance: true,
        balance_after_cents: 500,
      },
      {
        leader_user_id: leaderId,
        withdrawal_id: withdrawalId,
        idempotency_key: `reserved-${withdrawalId}`,
        event_type: 'withdrawal_reserved',
        entry_type: 'withdrawal_reserved',
        direction: 'out',
        amount_cents: 500,
        affects_available_balance: true,
        balance_after_cents: 0,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.adminCommandReceipt.deleteMany({
    where: { admin_user_id: ids.admin },
  });
  await prisma.adminAuditLog.deleteMany({
    where: { target_type: 'Withdrawal', target_id: withdrawalId },
  });
  await prisma.businessEventLog.deleteMany({
    where: { OR: [{ order_id: orderId }, { withdrawal_id: withdrawalId }] },
  });
  await prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } });
  await prisma.rewardLedger.deleteMany({ where: { leader_user_id: leaderId } });
  await prisma.withdrawalCommission.deleteMany({
    where: { withdrawal_id: withdrawalId },
  });
  await prisma.commission.deleteMany({ where: { order_id: orderId } });
  await prisma.withdrawal.deleteMany({ where: { id: withdrawalId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.groupBuy.deleteMany({ where: { id: groupBuyId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.community.deleteMany({ where: { id: communityId } });
  await prisma.user.deleteMany({
    where: { id: { in: [leaderId, customerId] } },
  });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('Admin withdrawal executor on PostgreSQL', () => {
  it('rejects once, restores the reserved reward once and replays', async () => {
    const command = input('reject', 'admin-withdrawal-reject-0001');
    const first = await executeAdminWithdrawalCommand(command);
    const replay = await executeAdminWithdrawalCommand(command);

    expect(first).toMatchObject({
      status: 'rejected',
      version: 2,
      idempotent: false,
    });
    expect(replay).toMatchObject({
      status: 'rejected',
      version: 2,
      idempotent: true,
    });
    await expect(
      prisma.commission.findUniqueOrThrow({ where: { id: commissionId } }),
    ).resolves.toMatchObject({ status: 'available', withdrawal_id: null });
    await expect(
      prisma.rewardLedger.count({
        where: {
          withdrawal_id: withdrawalId,
          event_type: 'withdrawal_rejected_restore',
        },
      }),
    ).resolves.toBe(1);
    await expect(commandWriteCounts()).resolves.toEqual({
      receipts: 1,
      audits: 1,
      events: 2,
      timelines: 1,
    });
    const events = await prisma.businessEventLog.findMany({
      where: { withdrawal_id: withdrawalId },
    });
    const globalEvent = events.find((event) => event.order_id === null);
    const orderEvent = events.find((event) => event.order_id === orderId);
    expect(globalEvent?.before_snapshot).not.toHaveProperty('commission_links');
    expect(orderEvent?.before_snapshot).not.toHaveProperty('commission_links');
    expect(orderEvent?.payload).toMatchObject({
      order_id: orderId,
      commission_ids: [commissionId],
    });
    expect(orderEvent?.payload).not.toHaveProperty('order_ids');
  });

  it('serializes concurrent balance snapshots for one leader', async () => {
    const keys = Array.from(
      { length: 12 },
      (_, index) => `concurrent-ledger-${suffix}-${index}`,
    );
    await Promise.all(
      keys.map((idempotencyKey) =>
        appendRewardLedgerEntry(prisma, {
          leader_user_id: leaderId,
          event_type: 'concurrent_restore_probe',
          entry_type: 'concurrent_restore_probe',
          direction: 'in',
          amount_cents: 10,
          affects_available_balance: true,
          idempotency_key: idempotencyKey,
        }),
      ),
    );
    const entries = await prisma.rewardLedger.findMany({
      where: { idempotency_key: { in: keys } },
      select: { balance_after_cents: true },
    });
    expect(entries).toHaveLength(keys.length);
    expect(
      entries.map((entry) => entry.balance_after_cents).sort((a, b) => a - b),
    ).toEqual(keys.map((_, index) => (index + 1) * 10));
  });

  it('allows exactly one concurrent approve or reject command', async () => {
    const settled = await Promise.allSettled([
      executeAdminWithdrawalCommand(
        input('approve', 'admin-withdrawal-race-approve'),
      ),
      executeAdminWithdrawalCommand(
        input('reject', 'admin-withdrawal-race-reject0'),
      ),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1);
    await expect(
      prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } }),
    ).resolves.toMatchObject({ version: 2 });
    await expect(
      prisma.adminCommandReceipt.count({
        where: { admin_user_id: ids.admin },
      }),
    ).resolves.toBe(1);
  });

  it('marks a tax-reviewed withdrawal paid once and replays', async () => {
    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'approved',
        version: 2,
        tax_mode: 'none',
        tax_status: 'completed',
      },
    });
    const command = input('mark-paid', 'admin-withdrawal-paid-00001', {
      expectedVersion: 2,
    });
    const first = await executeAdminWithdrawalCommand(command);
    const replay = await executeAdminWithdrawalCommand(command);

    expect(first).toMatchObject({
      status: 'paid',
      version: 3,
      idempotent: false,
    });
    expect(replay.idempotent).toBe(true);
    await expect(
      prisma.commission.findUniqueOrThrow({ where: { id: commissionId } }),
    ).resolves.toMatchObject({ status: 'withdrawn' });
    await expect(
      prisma.rewardLedger.count({
        where: {
          withdrawal_id: withdrawalId,
          event_type: 'withdrawal_paid',
          affects_available_balance: false,
        },
      }),
    ).resolves.toBe(1);
  });

  it('rejects stale version and wrong data scope with zero writes', async () => {
    await expect(
      executeAdminWithdrawalCommand(
        input('approve', 'admin-withdrawal-stale-001', {
          expectedVersion: 2,
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_WITHDRAWAL_VERSION_CONFLICT',
    });
    await expect(
      executeAdminWithdrawalCommand(
        input('approve', 'admin-withdrawal-scope-001', {
          adminContext: context(false),
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_WITHDRAWAL_FORBIDDEN',
    });
    await expect(commandWriteCounts()).resolves.toEqual({
      receipts: 0,
      audits: 0,
      events: 0,
      timelines: 0,
    });
  });
});
