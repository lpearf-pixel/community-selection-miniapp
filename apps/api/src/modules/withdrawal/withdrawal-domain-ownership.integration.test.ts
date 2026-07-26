import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import { executeAdminWithdrawalTaxReviewCommand } from './admin-withdrawal-tax-review-executor.js';
import { executeLeaderWithdrawalCommand } from './leader-withdrawal-executor.js';

const enabled = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `c3-withdrawal-admin-${suffix}`,
  leaderOpenid: `c3-withdrawal-leader-${suffix}`,
  customerOpenid: `c3-withdrawal-customer-${suffix}`,
  category: `C3 withdrawal category ${suffix}`,
  product: `C3 withdrawal product ${suffix}`,
  community: `C3 withdrawal community ${suffix}`,
  orderNo: `C3-WITHDRAWAL-${suffix}`,
};

let leaderId = '';
let customerId = '';
let categoryId = '';
let productId = '';
let communityId = '';
let groupBuyId = '';
let orderId = '';
let commissionId = '';

const adminContext: AdminAccessContext = {
  admin_user_id: ids.admin,
  role: 'super_admin',
  permissions: ['withdrawal.manage'],
  is_super_admin: true,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: true,
    can_access_all_communities: true,
  },
  data_scope_source: 'session',
};

async function createWithdrawal(requestId: string) {
  return executeLeaderWithdrawalCommand({
    leader_user_id: leaderId,
    command: {
      client_request_id: requestId,
      commission_ids: [commissionId],
      amount_cents: 500,
    },
  });
}

describe.skipIf(!enabled).sequential(
  'L50-C3 withdrawal owners on PostgreSQL',
  () => {
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
          nickname: 'C3 withdrawal leader',
          role: 'leader',
        },
      });
      leaderId = leader.id;
      const customer = await prisma.user.create({
        data: {
          openid: ids.customerOpenid,
          nickname: 'C3 withdrawal customer',
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
          address: 'C3 withdrawal integration address',
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
          receiver_name: 'C3 withdrawal',
          receiver_phone: '13800000000',
        },
      });
      orderId = order.id;
    });

    beforeEach(async () => {
      await prisma.adminCommandReceipt.deleteMany({
        where: { admin_user_id: ids.admin },
      });
      await prisma.adminAuditLog.deleteMany({
        where: { admin_user_id: ids.admin },
      });
      await prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } });
      await prisma.businessEventLog.deleteMany({
        where: { OR: [{ order_id: orderId }, { leader_user_id: leaderId }] },
      });
      await prisma.taxRecord.deleteMany({ where: { leader_user_id: leaderId } });
      await prisma.rewardLedger.deleteMany({ where: { leader_user_id: leaderId } });
      await prisma.withdrawalCommission.deleteMany({
        where: { commission: { order_id: orderId } },
      });
      await prisma.withdrawal.deleteMany({ where: { leader_user_id: leaderId } });
      await prisma.commission.deleteMany({ where: { order_id: orderId } });
      const commission = await prisma.commission.create({
        data: {
          leader_user_id: leaderId,
          order_id: orderId,
          group_buy_id: groupBuyId,
          base_amount_cents: 1_000,
          commission_type: 'fixed',
          commission_value: 500,
          estimated_amount_cents: 500,
          final_amount_cents: 500,
          status: 'available',
          available_at: new Date(),
          review_status: 'approved',
        },
      });
      commissionId = commission.id;
      await prisma.rewardLedger.create({
        data: {
          leader_user_id: leaderId,
          commission_id: commissionId,
          order_id: orderId,
          idempotency_key: `c3-available-${commissionId}`,
          event_type: 'commission_available',
          entry_type: 'commission_available',
          direction: 'in',
          amount_cents: 500,
          affects_available_balance: true,
          balance_after_cents: 500,
        },
      });
    });

    afterAll(async () => {
      await prisma.adminCommandReceipt.deleteMany({
        where: { admin_user_id: ids.admin },
      });
      await prisma.adminAuditLog.deleteMany({
        where: { admin_user_id: ids.admin },
      });
      await prisma.orderTimelineLog.deleteMany({ where: { order_id: orderId } });
      await prisma.businessEventLog.deleteMany({
        where: { OR: [{ order_id: orderId }, { leader_user_id: leaderId }] },
      });
      await prisma.taxRecord.deleteMany({ where: { leader_user_id: leaderId } });
      await prisma.rewardLedger.deleteMany({ where: { leader_user_id: leaderId } });
      await prisma.withdrawalCommission.deleteMany({
        where: { commission: { order_id: orderId } },
      });
      await prisma.withdrawal.deleteMany({ where: { leader_user_id: leaderId } });
      await prisma.commission.deleteMany({ where: { order_id: orderId } });
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

    it('creates once, replays once, and rejects GR-FIN-003 drift', async () => {
      const first = await createWithdrawal(`c3-create-${suffix}`);
      const replay = await createWithdrawal(`c3-create-${suffix}`);
      expect(first).toMatchObject({ applied: true, idempotent: false });
      expect(replay).toMatchObject({
        withdrawal_id: first.withdrawal_id,
        applied: false,
        idempotent: true,
      });
      await expect(
        executeLeaderWithdrawalCommand({
          leader_user_id: leaderId,
          command: {
            client_request_id: `c3-create-${suffix}`,
            commission_ids: [commissionId],
            amount_cents: 499,
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'LEADER_WITHDRAWAL_IDEMPOTENCY_CONFLICT',
      });
      await expect(
        prisma.rewardLedger.count({
          where: {
            withdrawal_id: first.withdrawal_id,
            event_type: 'withdrawal_reserved',
          },
        }),
      ).resolves.toBe(1);
    });

    it('allows one concurrent claimant for the same commission', async () => {
      const settled = await Promise.allSettled([
        createWithdrawal(`c3-race-a-${suffix}`),
        createWithdrawal(`c3-race-b-${suffix}`),
      ]);
      expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1);
      await expect(
        prisma.withdrawal.count({ where: { leader_user_id: leaderId } }),
      ).resolves.toBe(1);
    });

    it('tax-reviews once, replays, and rejects same-key command drift', async () => {
      const created = await createWithdrawal(`c3-tax-base-${suffix}`);
      const command = {
        idempotency_key: `c3-tax-review-${suffix}`,
        expected_version: 1,
        tax_mode: 'withheld' as const,
        taxable_amount_cents: 500,
        tax_amount_cents: 50,
        tax_rate_basis: '10%',
      };
      const first = await executeAdminWithdrawalTaxReviewCommand({
        withdrawal_id: created.withdrawal_id,
        command,
        context: adminContext,
        admin_meta: { ip_address: '127.0.0.1', user_agent: 'integration' },
      });
      const replay = await executeAdminWithdrawalTaxReviewCommand({
        withdrawal_id: created.withdrawal_id,
        command,
        context: adminContext,
        admin_meta: { ip_address: '127.0.0.1', user_agent: 'integration' },
      });
      expect(first).toMatchObject({
        idempotent: false,
        withdrawal: { version: 2, tax_amount_cents: 50 },
      });
      expect(replay).toMatchObject({
        idempotent: true,
        withdrawal: { version: 2 },
      });
      await expect(
        executeAdminWithdrawalTaxReviewCommand({
          withdrawal_id: created.withdrawal_id,
          command: { ...command, tax_amount_cents: 40 },
          context: adminContext,
          admin_meta: {},
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ADMIN_WITHDRAWAL_IDEMPOTENCY_KEY_REUSED',
      });
      await expect(
        prisma.adminCommandReceipt.count({
          where: {
            admin_user_id: ids.admin,
            operation: 'admin.withdrawal.tax-review.v1',
          },
        }),
      ).resolves.toBe(1);
    });
  },
);
