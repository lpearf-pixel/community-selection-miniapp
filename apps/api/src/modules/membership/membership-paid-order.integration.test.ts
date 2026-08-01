import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import { activateLegacyMembership } from './membership-lifecycle.js';
import { PrismaMembershipRepository } from './membership-repository.js';
import {
  createPaidMembershipOrder,
  createPrismaMembershipPaymentStore,
  markMembershipOrderPaid,
  markMembershipOrderPaidFromNotification,
} from './membership-paid-order.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `l56-paid-user-${suffix}`;
const batchId = `l56-paid-batch-${suffix}`;
const eligibilityId = `l56-paid-eligibility-${suffix}`;
const membershipOrderIds: string[] = [];
const alertDedupeKeys: string[] = [];

beforeAll(async () => {
  await prisma.user.create({ data: {
    id: userId, openid: `openid-${userId}`, nickname: 'L56 paid membership', status: 'active',
  } });
  await prisma.legacyMemberImportBatch.create({ data: {
    id: batchId, source_name: 'L56 integration', file_name: 'l56.csv',
    file_sha256: 'a'.repeat(64), status: 'confirmed', total_rows: 1, valid_rows: 1,
    duplicate_rows: 0, invalid_rows: 0, matched_rows: 1, pending_rows: 0,
    operator_admin_id: 'l56-integration', confirmed_admin_id: 'l56-integration',
    confirmed_at: new Date('2026-07-31T00:00:00.000Z'),
  } });
  await prisma.legacyMemberEligibility.create({ data: {
    id: eligibilityId, batch_id: batchId, phone_fingerprint: `fingerprint-${suffix}`,
    masked_phone: '138****0000', user_id: userId, status: 'active',
  } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actor_user_id: userId } });
  await prisma.opsAlertLog.deleteMany({ where: { dedupe_key: { in: alertDedupeKeys } } });
  await prisma.membershipOrder.updateMany({
    where: { id: { in: membershipOrderIds } },
    data: { paid_payment_id: null },
  });
  await prisma.membershipPayment.deleteMany({ where: { membership_order_id: { in: membershipOrderIds } } });
  await prisma.membershipOrder.deleteMany({ where: { id: { in: membershipOrderIds } } });
  await prisma.legacyMemberEligibility.deleteMany({ where: { id: eligibilityId } });
  await prisma.membershipPeriod.deleteMany({ where: { user_id: userId } });
  await prisma.membershipAccount.deleteMany({ where: { user_id: userId } });
  await prisma.legacyMemberImportBatch.deleteMany({ where: { id: batchId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe.sequential('annual membership lifecycle on PostgreSQL', () => {
  it('converges concurrent legacy activation retries to one period', async () => {
    const repository = new PrismaMembershipRepository();
    const command = {
      enabled: true, userId, eligibilityId,
      idempotencyKey: `l56-legacy-concurrent-${suffix}`,
      now: new Date('2026-07-31T00:00:00.000Z'),
    };
    const results = await Promise.all([
      activateLegacyMembership(command, repository),
      activateLegacyMembership(command, repository),
    ]);
    expect(new Set(results.map((item) => item.periodId)).size).toBe(1);
    await expect(prisma.membershipPeriod.count({
      where: { user_id: userId, source: 'legacy_free' },
    })).resolves.toBe(1);
  });

  it('creates one 8800-cent order and converges concurrent payment callbacks', async () => {
    const created = await createPaidMembershipOrder({
      enabled: true, userId, idempotencyKey: `l56-paid-order-1-${suffix}`,
    });
    membershipOrderIds.push(created.membership_order_id);
    const replay = await createPaidMembershipOrder({
      enabled: true, userId, idempotencyKey: `l56-paid-order-1-${suffix}`,
    });
    expect(replay).toMatchObject({
      membership_order_id: created.membership_order_id, amount_cents: 8_800, idempotent: true,
    });
    const paymentStore = createPrismaMembershipPaymentStore();
    const preparedAttempts = await Promise.allSettled([
      paymentStore.prepare(userId, created.membership_order_id, new Date('2026-08-01T00:00:00.000Z')),
      paymentStore.prepare(userId, created.membership_order_id, new Date('2026-08-01T00:00:00.000Z')),
    ]);
    expect(preparedAttempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(preparedAttempts.find((item) => item.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'MEMBERSHIP_PAYMENT_INITIALIZATION_IN_PROGRESS' }),
    });
    const prepared = preparedAttempts.find((item) => item.status === 'fulfilled')!.value;
    const info = {
      payment_id: prepared.payment.id, out_trade_no: prepared.payment.out_trade_no,
      transaction_id: `l56-paid-txn-1-${suffix}`,
      provider_success_at: new Date('2026-08-01T00:00:00.000Z'),
    };
    const results = await Promise.all([
      markMembershipOrderPaid(created.membership_order_id, info),
      markMembershipOrderPaid(created.membership_order_id, info),
    ]);
    expect(new Set(results.map((item) => item.membership_period_id)).size).toBe(1);
    expect(results[0]).toMatchObject({
      amount_cents: 8_800, starts_at: new Date('2027-07-31T00:00:00.000Z'),
      ends_at: new Date('2028-07-30T00:00:00.000Z'),
    });

    const duplicatePayment = await prisma.membershipPayment.create({ data: {
      membership_order_id: created.membership_order_id, attempt_no: 2,
      out_trade_no: `MBRDUPLICATE${suffix}`.slice(0, 32), amount_cents: 8_800,
      trade_state: 'prepay',
    } });
    alertDedupeKeys.push(`membership-duplicate-charge:${duplicatePayment.id}`);
    await expect(markMembershipOrderPaid(created.membership_order_id, {
      payment_id: duplicatePayment.id, out_trade_no: duplicatePayment.out_trade_no,
      transaction_id: `l56-paid-duplicate-txn-${suffix}`,
      provider_success_at: new Date('2026-08-01T00:01:00.000Z'),
    })).rejects.toMatchObject({ code: 'MEMBERSHIP_DUPLICATE_CHARGE_REQUIRES_REFUND' });
    await expect(prisma.membershipPayment.findUniqueOrThrow({ where: { id: duplicatePayment.id } }))
      .resolves.toMatchObject({ trade_state: 'duplicate_charge' });
    await expect(prisma.opsAlertLog.count({
      where: { dedupe_key: `membership-duplicate-charge:${duplicatePayment.id}`, status: 'open' },
    })).resolves.toBe(1);
    await expect(markMembershipOrderPaidFromNotification(created.membership_order_id, {
      payment_id: duplicatePayment.id, out_trade_no: duplicatePayment.out_trade_no,
      transaction_id: `l56-paid-duplicate-txn-${suffix}`,
      provider_success_at: new Date('2026-08-01T00:01:00.000Z'),
    })).resolves.toEqual({
      manual_refund_required: true, code: 'MEMBERSHIP_DUPLICATE_CHARGE_REQUIRES_REFUND',
    });
    await expect(prisma.auditLog.count({ where: {
      actor_user_id: userId, action: 'annual_membership_duplicate_charge_detected',
      target_id: created.membership_order_id,
    } })).resolves.toBe(1);
  });

  it('renews from the current end and never overlaps an existing period', async () => {
    const created = await createPaidMembershipOrder({
      enabled: true, userId, idempotencyKey: `l56-paid-order-2-${suffix}`,
    });
    membershipOrderIds.push(created.membership_order_id);
    const prepared = await createPrismaMembershipPaymentStore().prepare(
      userId, created.membership_order_id, new Date('2026-08-02T00:00:00.000Z'),
    );
    alertDedupeKeys.push(`membership-payment-exception:${prepared.payment.id}`);
    const paid = await markMembershipOrderPaid(created.membership_order_id, {
      payment_id: prepared.payment.id, out_trade_no: prepared.payment.out_trade_no,
      transaction_id: `l56-paid-txn-2-${suffix}`,
      provider_success_at: new Date('2026-08-02T00:00:00.000Z'),
    });
    expect(paid).toMatchObject({
      starts_at: new Date('2028-07-30T00:00:00.000Z'),
      ends_at: new Date('2029-07-30T00:00:00.000Z'),
    });
    await expect(prisma.membershipPeriod.count({ where: { user_id: userId } })).resolves.toBe(3);
  });

  it('blocks known suspension before payment and records a post-initialization suspension exception', async () => {
    const account = await prisma.membershipAccount.update({
      where: { user_id: userId }, data: { status: 'suspended', suspension_reason: 'integration-test' },
    });
    await expect(createPaidMembershipOrder({
      enabled: true, userId, idempotencyKey: `l56-suspended-block-${suffix}`,
    })).rejects.toMatchObject({ code: 'MEMBERSHIP_SUSPENDED' });

    await prisma.membershipAccount.update({
      where: { id: account.id }, data: { status: 'active', suspension_reason: null },
    });
    const created = await createPaidMembershipOrder({
      enabled: true, userId, idempotencyKey: `l56-suspension-race-${suffix}`,
    });
    membershipOrderIds.push(created.membership_order_id);
    const prepared = await createPrismaMembershipPaymentStore().prepare(
      userId, created.membership_order_id, new Date('2026-08-03T00:00:00.000Z'),
    );
    await prisma.membershipAccount.update({
      where: { id: account.id }, data: { status: 'suspended', suspension_reason: 'post-initialization' },
    });
    await expect(markMembershipOrderPaid(created.membership_order_id, {
      payment_id: prepared.payment.id, out_trade_no: prepared.payment.out_trade_no,
      transaction_id: `l56-suspended-race-txn-${suffix}`,
      provider_success_at: new Date('2026-08-03T00:01:00.000Z'),
    })).rejects.toMatchObject({ code: 'MEMBERSHIP_SUSPENDED_AFTER_INITIALIZATION' });
    await expect(prisma.membershipOrder.findUniqueOrThrow({ where: { id: created.membership_order_id } }))
      .resolves.toMatchObject({
        status: 'payment_exception', membership_period_id: null,
        paid_payment_id: prepared.payment.id,
      });

    const duplicatePayment = await prisma.membershipPayment.create({ data: {
      membership_order_id: created.membership_order_id, attempt_no: 2,
      out_trade_no: `MBRSUSPENDDUP${suffix}`.slice(0, 32), amount_cents: 8_800,
      trade_state: 'prepay',
    } });
    alertDedupeKeys.push(`membership-duplicate-charge:${duplicatePayment.id}`);
    await expect(markMembershipOrderPaidFromNotification(created.membership_order_id, {
      payment_id: duplicatePayment.id, out_trade_no: duplicatePayment.out_trade_no,
      transaction_id: `l56-suspended-duplicate-txn-${suffix}`,
      provider_success_at: new Date('2026-08-03T00:02:00.000Z'),
    })).resolves.toEqual({
      manual_refund_required: true, code: 'MEMBERSHIP_DUPLICATE_CHARGE_REQUIRES_REFUND',
    });
    await expect(prisma.membershipPayment.findUniqueOrThrow({ where: { id: duplicatePayment.id } }))
      .resolves.toMatchObject({ trade_state: 'duplicate_charge' });
    await prisma.membershipAccount.update({
      where: { id: account.id }, data: { status: 'active', suspension_reason: null },
    });
  });
});
