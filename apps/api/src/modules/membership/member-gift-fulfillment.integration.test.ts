import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import { claimGift } from './member-gift-service.js';
import { PrismaMemberGiftRepository } from './member-gift-repository.js';
import {
  applyOrderGiftFulfillmentEvent,
  createAdminMemberGiftService,
  GiftFulfillmentBlockError,
} from './member-gift-fulfillment.js';
import { executeAdminDeliveryStatusCommand } from '../delivery/admin-delivery-status-executor.js';
import { executeAdminPickupVerificationCommand } from '../order/admin-pickup-verification-executor.js';
import { executeAdminRefundCommand } from '../refund/admin-refund-executor.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `l56-gift-admin-${suffix}`,
  user: `l56-gift-user-${suffix}`,
  account: `l56-gift-account-${suffix}`,
  period: `l56-gift-period-${suffix}`,
  category: `L56 gift category ${suffix}`,
  product: `L56 gift product ${suffix}`,
  campaign: `l56-gift-campaign-${suffix}`,
};
const now = new Date('2026-07-31T12:00:00.000Z');
const orderIds: string[] = [];
const afterSaleCaseIds: string[] = [];
const repository = new PrismaMemberGiftRepository();
const originalMockWechatPay = process.env.MOCK_WECHAT_PAY;
const adminContext: AdminAccessContext = {
  admin_user_id: ids.admin, role: 'super_admin', permissions: ['admin.full_access'],
  is_super_admin: true,
  data_scope: { pickup_store_ids: [], community_ids: [], can_access_all_pickup_stores: true, can_access_all_communities: true },
  data_scope_source: 'session',
};
const scopedOutContext: AdminAccessContext = {
  ...adminContext,
  role: 'store_manager',
  permissions: ['order.manage'],
  is_super_admin: false,
  data_scope: {
    pickup_store_ids: ['another-store'], community_ids: ['another-community'],
    can_access_all_pickup_stores: false, can_access_all_communities: false,
  },
  data_scope_source: 'header_mock',
};

async function createPaidOrder(label: string) {
  const order = await prisma.order.create({ data: {
    order_no: `L56-GIFT-${label}-${suffix}`,
    user_id: ids.user,
    total_amount_cents: 1_000, product_amount_cents: 1_000,
    pay_amount_cents: 1_000, pay_status: 'paid', order_status: 'paid',
    pickup_type: label.includes('pickup') ? 'store' : 'delivery',
    delivery_status: label.includes('pickup') ? null : 'pending_dispatch',
    receiver_name: 'L56 gift integration', receiver_phone: '13800000000',
  } });
  orderIds.push(order.id);
  return order;
}

async function createReservedClaim(label: string) {
  const order = await createPaidOrder(label);
  const result = await claimGift({
    enabled: true, userId: ids.user, orderId: order.id,
    campaignId: ids.campaign, quantity: 1,
    idempotencyKey: `l56-gift-claim-${label}-${suffix}`, now,
    membership: { active: true, accountId: ids.account, periodId: ids.period },
  }, repository);
  return { orderId: order.id, claimId: result.claimId };
}

beforeAll(async () => {
  process.env.MOCK_WECHAT_PAY = 'true';
  await prisma.adminUser.create({ data: {
    id: ids.admin, username: ids.admin, password_hash: 'integration-only', status: 'active',
  } });
  await prisma.user.create({ data: {
    id: ids.user, openid: `openid-${ids.user}`, nickname: 'L56 gift integration', status: 'active',
  } });
  const category = await prisma.category.create({ data: { name: ids.category, status: 'active' } });
  const product = await prisma.product.create({ data: {
    name: ids.product, category_id: category.id, price_cents: 500, cost_price_cents: 300,
    stock: 100, unit: '份', status: 'active',
  } });
  await prisma.membershipAccount.create({ data: {
    id: ids.account, user_id: ids.user, status: 'active',
    starts_at: new Date('2026-07-01T00:00:00.000Z'), ends_at: new Date('2027-07-01T00:00:00.000Z'),
  } });
  await prisma.membershipPeriod.create({ data: {
    id: ids.period, account_id: ids.account, user_id: ids.user, source: 'manual',
    source_id: `l56-gift-period-source-${suffix}`, idempotency_key: `l56-gift-period-key-${suffix}`,
    starts_at: new Date('2026-07-01T00:00:00.000Z'), ends_at: new Date('2027-07-01T00:00:00.000Z'),
  } });
  await prisma.memberGiftCampaign.create({ data: {
    id: ids.campaign, name: 'L56 新品赠品', gift_product_id: product.id, status: 'active',
    starts_at: new Date('2026-07-01T00:00:00.000Z'), ends_at: new Date('2026-09-01T00:00:00.000Z'),
    max_claims_per_member: 10, inventory_total: 10,
  } });
});

afterAll(async () => {
  await prisma.refund.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.afterSaleLog.deleteMany({ where: { after_sale_case_id: { in: afterSaleCaseIds } } });
  await prisma.afterSaleCase.deleteMany({ where: { id: { in: afterSaleCaseIds } } });
  await prisma.memberGiftInventoryEvent.deleteMany({ where: { campaign_id: ids.campaign } });
  await prisma.memberGiftClaim.deleteMany({ where: { campaign_id: ids.campaign } });
  await prisma.memberGiftCampaign.deleteMany({ where: { id: ids.campaign } });
  await prisma.wechatShippingIntent.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.adminCommandReceipt.deleteMany({ where: { admin_user_id: ids.admin } });
  await prisma.adminAuditLog.deleteMany({ where: { admin_user_id: ids.admin } });
  await prisma.businessEventLog.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.orderTimelineLog.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.membershipPeriod.deleteMany({ where: { id: ids.period } });
  await prisma.membershipAccount.deleteMany({ where: { id: ids.account } });
  await prisma.product.deleteMany({ where: { name: ids.product } });
  await prisma.category.deleteMany({ where: { name: ids.category } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  if (originalMockWechatPay === undefined) delete process.env.MOCK_WECHAT_PAY;
  else process.env.MOCK_WECHAT_PAY = originalMockWechatPay;
  await prisma.$disconnect();
});

describe.sequential('member gift fulfillment on PostgreSQL', () => {
  it('atomically records delivery start and then consumes reserved inventory on delivery', async () => {
    const item = await createReservedClaim('delivery');
    const delivering = await executeAdminDeliveryStatusCommand({
      order_id: item.orderId,
      command: { delivery_status: 'delivering', expected_version: 1, idempotency_key: `l56-delivery-start-${suffix}` },
      context: adminContext, admin_meta: {},
    });
    const started = await prisma.memberGiftClaim.findUniqueOrThrow({ where: { id: item.claimId } });
    expect(started.status).toBe('reserved');
    expect(started.fulfillment_started_at).not.toBeNull();

    await executeAdminDeliveryStatusCommand({
      order_id: item.orderId,
      command: { delivery_status: 'delivered', expected_version: delivering.version, idempotency_key: `l56-delivery-done-${suffix}` },
      context: adminContext, admin_meta: {},
    });
    const [claim, campaign, events] = await Promise.all([
      prisma.memberGiftClaim.findUniqueOrThrow({ where: { id: item.claimId } }),
      prisma.memberGiftCampaign.findUniqueOrThrow({ where: { id: ids.campaign } }),
      prisma.memberGiftInventoryEvent.findMany({ where: { claim_id: item.claimId }, orderBy: { created_at: 'asc' } }),
    ]);
    expect(claim.status).toBe('delivered');
    expect(campaign).toMatchObject({ inventory_reserved: 0, inventory_delivered: 1 });
    expect(events.map((event) => [event.event_type, event.actor_admin_user_id])).toEqual([
      ['reserve', null], ['fulfillment_start', ids.admin], ['deliver', ids.admin],
    ]);
  });

  it('delivers a reserved gift in the same transaction as pickup verification', async () => {
    const item = await createReservedClaim('pickup');
    await prisma.order.update({ where: { id: item.orderId }, data: { order_status: 'ready' } });
    await executeAdminPickupVerificationCommand({
      order_id: item.orderId,
      command: { expected_version: 1, idempotency_key: `l56-pickup-verify-${suffix}`, admin_remark: '赠品随订单当面交付' },
      context: adminContext, admin_meta: {},
    });
    await expect(prisma.memberGiftClaim.findUniqueOrThrow({ where: { id: item.claimId } }))
      .resolves.toMatchObject({ status: 'delivered' });
  });

  it('releases an unstarted reservation for a full refund', async () => {
    const item = await createReservedClaim('refund-release');
    const afterSale = await prisma.afterSaleCase.create({ data: {
      order_id: item.orderId, user_id: ids.user, type: 'refund', status: 'approved',
      resolution_type: 'refund', reason: 'L56 全额退款释放赠品',
      requested_refund_cents: 1_000, approved_refund_cents: 1_000,
      approved_product_refund_cents: 1_000, approved_delivery_refund_cents: 0,
      reviewed_by_admin_id: ids.admin, reviewed_at: now,
    } });
    afterSaleCaseIds.push(afterSale.id);
    await executeAdminRefundCommand({
      after_sale_case_id: afterSale.id,
      command: {
        expected_version: 1,
        idempotency_key: `l56-refund-release-${suffix}`,
        admin_remark: '全额退款并释放尚未履约的会员赠品',
      },
      context: adminContext,
      admin_meta: {},
    });
    await expect(prisma.memberGiftClaim.findUniqueOrThrow({ where: { id: item.claimId } }))
      .resolves.toMatchObject({ status: 'released' });
    await expect(prisma.refund.count({ where: { order_id: item.orderId } })).resolves.toBe(1);
  });

  it('blocks a full refund after fulfillment starts', async () => {
    const item = await createReservedClaim('refund-block');
    await prisma.$transaction((tx) => applyOrderGiftFulfillmentEvent(tx, {
      orderId: item.orderId, event: 'delivery_started', actorAdminUserId: ids.admin,
      idempotencyKey: `l56-refund-block-start-${suffix}`, now,
    }));
    await expect(prisma.$transaction((tx) => applyOrderGiftFulfillmentEvent(tx, {
      orderId: item.orderId, event: 'full_refund', actorAdminUserId: ids.admin,
      idempotencyKey: `l56-refund-block-${suffix}`, now,
    }))).rejects.toBeInstanceOf(GiftFulfillmentBlockError);
  });

  it('writes off a reserved gift under an admin identity without restoring inventory', async () => {
    const item = await createReservedClaim('writeoff');
    await createAdminMemberGiftService().writeOff({
      claimId: item.claimId, context: adminContext, reason: 'damaged',
      idempotencyKey: `l56-writeoff-${suffix}`,
    });
    const [claim, event] = await Promise.all([
      prisma.memberGiftClaim.findUniqueOrThrow({ where: { id: item.claimId } }),
      prisma.memberGiftInventoryEvent.findUniqueOrThrow({ where: { idempotency_key: `l56-writeoff-${suffix}` } }),
    ]);
    expect(claim).toMatchObject({ status: 'written_off', loss_reason: 'damaged' });
    expect(event).toMatchObject({ event_type: 'write_off', actor_user_id: null, actor_admin_user_id: ids.admin });
  });

  it('does not list or mutate claims outside the admin data scope', async () => {
    const item = await createReservedClaim('scope-denied');
    await expect(createAdminMemberGiftService().list({
      status: 'reserved', context: scopedOutContext,
    })).resolves.toEqual({ items: [] });
    await expect(createAdminMemberGiftService().writeOff({
      claimId: item.claimId, context: scopedOutContext, reason: 'lost',
      idempotencyKey: `l56-writeoff-scope-denied-${suffix}`,
    })).rejects.toMatchObject({ statusCode: 403, code: 'ADMIN_SCOPE_FORBIDDEN' });
    await expect(prisma.memberGiftClaim.findUniqueOrThrow({ where: { id: item.claimId } }))
      .resolves.toMatchObject({ status: 'reserved' });
  });

  it('converges concurrent identical admin delivery commands', async () => {
    const item = await createReservedClaim('admin-deliver-concurrent');
    const command = {
      claimId: item.claimId, context: adminContext,
      idempotencyKey: `l56-admin-deliver-concurrent-${suffix}`,
    };
    const service = createAdminMemberGiftService();
    const results = await Promise.all([service.deliver(command), service.deliver(command)]);
    expect(new Set(results.map((result) => result.claim_id)).size).toBe(1);
    expect(results.every((result) => result.status === 'delivered')).toBe(true);
    await expect(prisma.memberGiftInventoryEvent.count({
      where: { idempotency_key: command.idempotencyKey },
    })).resolves.toBe(1);
  });

  it('converges concurrent same-key reservations without double-counting inventory', async () => {
    const order = await createPaidOrder('concurrent-reserve');
    const input = {
      enabled: true, userId: ids.user, orderId: order.id,
      campaignId: ids.campaign, quantity: 1 as const,
      idempotencyKey: `l56-gift-concurrent-reserve-${suffix}`, now,
      membership: { active: true as const, accountId: ids.account, periodId: ids.period },
    };
    const results = await Promise.all([
      claimGift(input, repository), claimGift(input, repository),
    ]);
    expect(new Set(results.map((item) => item.claimId)).size).toBe(1);
    await expect(prisma.memberGiftClaim.count({ where: { order_id: order.id } })).resolves.toBe(1);
    const otherOrder = await createPaidOrder('idempotency-reuse');
    await expect(claimGift({ ...input, orderId: otherOrder.id }, repository))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});
