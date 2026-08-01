import { createHash, randomUUID } from 'node:crypto';
import {
  Prisma,
  type MembershipOrder,
  type MembershipPayment,
  type MembershipPeriod,
} from '@prisma/client';
import { prisma } from '../../db.js';
import type { PaymentInfo } from '../payment/payment-record-service.js';
import type { WechatPaymentStore } from '../payment/wechat-payment-command.js';
import { MembershipPolicyError } from './membership-lifecycle.js';
import { upsertOpsAlert } from '../operations/ops-alert-owner.js';

const MEMBERSHIP_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;
export const MEMBERSHIP_ANNUAL_PRICE_CENTS = 8_800;

export function planPaidMembershipPeriod(input: {
  paidAt: Date;
  currentEndsAt: Date | null;
}) {
  const startsAt = input.currentEndsAt && input.currentEndsAt > input.paidAt
    ? input.currentEndsAt
    : input.paidAt;
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + MEMBERSHIP_YEAR_MS),
  };
}

function mapOrder(order: MembershipOrder) {
  return {
    membership_order_id: order.id,
    order_no: order.order_no,
    amount_cents: order.amount_cents,
    status: order.status,
    membership_period_id: order.membership_period_id,
    paid_at: order.paid_at,
    idempotent: false,
  };
}

function orderNo(userId: string, idempotencyKey: string) {
  return `MBR${createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex').slice(0, 25).toUpperCase()}`;
}

function outTradeNo(orderId: string, attemptNo: number) {
  return `MBR${createHash('sha256').update(orderId).digest('hex').slice(0, 24).toUpperCase()}${String(attemptNo).padStart(3, '0')}`;
}

function isPrismaCode(error: unknown, code: string) {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

export async function createPaidMembershipOrder(input: {
  enabled: boolean;
  userId: string;
  idempotencyKey: string;
}) {
  if (!input.enabled) throw new MembershipPolicyError('MEMBERSHIP_DISABLED', '会员功能尚未启用', 503);
  if (!input.userId.trim() || !input.idempotencyKey.trim()) {
    throw new MembershipPolicyError('MEMBERSHIP_ORDER_INVALID', '会员订单参数无效', 400);
  }
  const existing = await prisma.membershipOrder.findUnique({
    where: { idempotency_key: input.idempotencyKey },
  });
  if (existing) {
    if (existing.user_id !== input.userId) {
      throw new MembershipPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他会员订单');
    }
    return { ...mapOrder(existing), idempotent: true };
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
      const account = await tx.membershipAccount.findUnique({ where: { user_id: input.userId } });
      if (account?.status === 'suspended') {
        throw new MembershipPolicyError('MEMBERSHIP_SUSPENDED', '会员账户已暂停，不能购买或续费', 409);
      }
      return tx.membershipOrder.create({ data: {
        order_no: orderNo(input.userId, input.idempotencyKey),
        user_id: input.userId,
        amount_cents: MEMBERSHIP_ANNUAL_PRICE_CENTS,
        idempotency_key: input.idempotencyKey,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return mapOrder(created);
  } catch (error) {
    if (!isPrismaCode(error, 'P2002')) throw error;
    const replay = await prisma.membershipOrder.findUniqueOrThrow({
      where: { idempotency_key: input.idempotencyKey },
    });
    if (replay.user_id !== input.userId) {
      throw new MembershipPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他会员订单');
    }
    return { ...mapOrder(replay), idempotent: true };
  }
}

export function createPrismaMembershipPaymentStore(
  client: typeof prisma = prisma,
): WechatPaymentStore {
  return {
    async prepare(userId, orderId, now) {
      const execute = () => client.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT id FROM "MembershipOrder" WHERE id = ${orderId} FOR UPDATE`;
        const order = await tx.membershipOrder.findUnique({
          where: { id: orderId }, include: { user: true },
        });
        if (!order) throw new Error('MEMBERSHIP_PAYMENT_ORDER_NOT_FOUND');
        if (order.user_id !== userId) throw new Error('MEMBERSHIP_PAYMENT_ORDER_FORBIDDEN');
        if (order.user.status !== 'active') throw new Error('MEMBERSHIP_PAYMENT_USER_DISABLED');
        if (order.status !== 'pending_payment') throw new Error('MEMBERSHIP_PAYMENT_ORDER_NOT_PAYABLE');
        const account = await tx.membershipAccount.findUnique({ where: { user_id: userId } });
        if (account?.status === 'suspended') {
          throw new MembershipPolicyError('MEMBERSHIP_SUSPENDED', '会员账户已暂停，不能购买或续费', 409);
        }
        const latest = await tx.membershipPayment.findFirst({
          where: { membership_order_id: order.id }, orderBy: { attempt_no: 'desc' },
        });
        if (
          latest?.prepay_id && latest.prepay_expires_at && latest.prepay_expires_at > now &&
          ['created', 'prepay'].includes(latest.trade_state)
        ) {
          return {
            order: {
              id: order.id, order_no: order.order_no,
              pay_amount_cents: order.amount_cents, openid: order.user.openid,
              description: `社区甄选年费会员 ${order.order_no}`,
            },
            payment: latest,
          };
        }
        if (
          latest?.trade_state === 'created' &&
          latest.created_at.getTime() > now.getTime() - 15 * 60 * 1_000
        ) {
          throw new MembershipPolicyError(
            'MEMBERSHIP_PAYMENT_INITIALIZATION_IN_PROGRESS',
            '会员支付正在初始化，请勿重复提交',
            409,
          );
        }
        const attemptNo = (latest?.attempt_no ?? 0) + 1;
        const payment = await tx.membershipPayment.create({ data: {
          membership_order_id: order.id, attempt_no: attemptNo,
          out_trade_no: outTradeNo(order.id, attemptNo), amount_cents: order.amount_cents,
        } });
        return {
          order: {
            id: order.id, order_no: order.order_no,
            pay_amount_cents: order.amount_cents, openid: order.user.openid,
            description: `社区甄选年费会员 ${order.order_no}`,
          },
          payment,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await execute();
        } catch (error) {
          if (!isPrismaCode(error, 'P2034') || attempt === 2) throw error;
        }
      }
      throw new Error('MEMBERSHIP_PAYMENT_PREPARE_RETRY_EXHAUSTED');
    },
    async savePrepay(paymentId, prepayId, expiresAt) {
      await client.membershipPayment.update({
        where: { id: paymentId },
        data: { prepay_id: prepayId, prepay_expires_at: expiresAt, trade_state: 'prepay', last_provider_error_code: null },
      });
    },
  };
}

function mapPaidResult(order: MembershipOrder, period: MembershipPeriod) {
  return {
    membership_order_id: order.id,
    order_no: order.order_no,
    amount_cents: order.amount_cents,
    status: order.status,
    paid_at: order.paid_at,
    membership_period_id: period.id,
    starts_at: period.starts_at,
    ends_at: period.ends_at,
  };
}

async function recordDuplicateMembershipCharge(
  tx: Prisma.TransactionClient,
  order: MembershipOrder,
  payment: MembershipPayment,
  paymentInfo: PaymentInfo,
) {
  if (payment.trade_state === 'duplicate_charge') {
    return { exception: 'MEMBERSHIP_DUPLICATE_CHARGE_REQUIRES_REFUND' as const };
  }
  await tx.membershipPayment.update({
    where: { id: payment.id },
    data: {
      transaction_id: paymentInfo.transaction_id,
      trade_state: 'duplicate_charge',
      provider_success_at: paymentInfo.provider_success_at,
      last_provider_error_code: 'MEMBERSHIP_DUPLICATE_CHARGE_REQUIRES_REFUND',
    },
  });
  await tx.auditLog.create({ data: {
    actor_user_id: order.user_id, action: 'annual_membership_duplicate_charge_detected',
    target_type: 'MembershipOrder', target_id: order.id,
    payload: {
      effective_payment_id: order.paid_payment_id,
      duplicate_payment_id: payment.id,
      duplicate_out_trade_no: payment.out_trade_no,
      amount_cents: payment.amount_cents,
    },
  } });
  await upsertOpsAlert(tx, `membership-duplicate-charge:${payment.id}`, {
    alert_type: 'membership_duplicate_charge', alert_level: 'critical',
    title: '会员费疑似重复扣款', message: '同一会员订单收到第二笔成功支付，需人工退款',
    payload: {
      membership_order_id: order.id, membership_payment_id: payment.id,
      out_trade_no: payment.out_trade_no, amount_cents: payment.amount_cents,
    },
  });
  return { exception: 'MEMBERSHIP_DUPLICATE_CHARGE_REQUIRES_REFUND' as const };
}

export async function markMembershipOrderPaid(
  membershipOrderId: string,
  paymentInfo: PaymentInfo,
) {
  const execute = () => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MembershipOrder" WHERE id = ${membershipOrderId} FOR UPDATE`;
    const order = await tx.membershipOrder.findUnique({ where: { id: membershipOrderId } });
    if (!order) throw new Error('MEMBERSHIP_PAYMENT_ORDER_NOT_FOUND');
    const payment = paymentInfo.payment_id
      ? await tx.membershipPayment.findUnique({ where: { id: paymentInfo.payment_id } })
      : paymentInfo.out_trade_no
        ? await tx.membershipPayment.findUnique({ where: { out_trade_no: paymentInfo.out_trade_no } })
        : await tx.membershipPayment.findFirst({
            where: { membership_order_id: order.id }, orderBy: { attempt_no: 'desc' },
          });
    if (!payment || payment.membership_order_id !== order.id || payment.amount_cents !== MEMBERSHIP_ANNUAL_PRICE_CENTS) {
      throw new Error('MEMBERSHIP_PAYMENT_RECORD_INVALID');
    }
    if (order.status === 'payment_exception') {
      if (order.paid_payment_id !== payment.id) {
        return recordDuplicateMembershipCharge(tx, order, payment, paymentInfo);
      }
      return { exception: 'MEMBERSHIP_PAYMENT_EXCEPTION_REQUIRES_REFUND' as const };
    }
    if (order.status === 'paid' && order.membership_period_id) {
      if (order.paid_payment_id !== payment.id) {
        return recordDuplicateMembershipCharge(tx, order, payment, paymentInfo);
      }
      const period = await tx.membershipPeriod.findUniqueOrThrow({ where: { id: order.membership_period_id } });
      if (!payment.transaction_id && paymentInfo.transaction_id) {
        await tx.membershipPayment.update({
          where: { id: payment.id },
          data: { transaction_id: paymentInfo.transaction_id, trade_state: 'paid', provider_success_at: paymentInfo.provider_success_at },
        });
      }
      return mapPaidResult(order, period);
    }
    if (order.status !== 'pending_payment') throw new Error('MEMBERSHIP_PAYMENT_ORDER_NOT_PAYABLE');
    const paidAt = paymentInfo.provider_success_at ?? new Date();
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${order.user_id} FOR UPDATE`;
    const account = await tx.membershipAccount.findUnique({ where: { user_id: order.user_id } });
    if (account?.status === 'suspended') {
      await tx.membershipOrder.update({
        where: { id: order.id },
        data: { status: 'payment_exception', paid_at: paidAt, paid_payment_id: payment.id },
      });
      await tx.membershipPayment.update({
        where: { id: payment.id }, data: {
          trade_state: 'paid_exception', transaction_id: paymentInfo.transaction_id,
          provider_success_at: paidAt, last_provider_error_code: 'MEMBERSHIP_SUSPENDED_AFTER_INITIALIZATION',
        },
      });
      await tx.auditLog.create({ data: {
        actor_user_id: order.user_id, action: 'annual_membership_payment_exception',
        target_type: 'MembershipOrder', target_id: order.id,
        payload: {
          reason: 'membership_suspended_after_initialization',
          membership_payment_id: payment.id, out_trade_no: payment.out_trade_no,
          amount_cents: payment.amount_cents,
        },
      } });
      await upsertOpsAlert(tx, `membership-payment-exception:${payment.id}`, {
        alert_type: 'membership_payment_exception', alert_level: 'critical',
        title: '会员费已支付但权益未生效', message: '支付初始化后账户被暂停，需人工退款',
        payload: {
          membership_order_id: order.id, membership_payment_id: payment.id,
          out_trade_no: payment.out_trade_no, amount_cents: payment.amount_cents,
        },
      });
      return { exception: 'MEMBERSHIP_SUSPENDED_AFTER_INITIALIZATION' as const };
    }
    const planned = planPaidMembershipPeriod({ paidAt, currentEndsAt: account?.ends_at ?? null });
    const membershipAccount = account
      ? await tx.membershipAccount.update({
          where: { id: account.id },
          data: { status: 'active', ends_at: planned.endsAt, suspension_reason: null },
        })
      : await tx.membershipAccount.create({ data: {
          id: randomUUID(), user_id: order.user_id, status: 'active',
          starts_at: planned.startsAt, ends_at: planned.endsAt,
        } });
    const period = await tx.membershipPeriod.create({ data: {
      id: randomUUID(), account_id: membershipAccount.id, user_id: order.user_id,
      source: 'annual_paid', source_id: order.id,
      idempotency_key: `annual-paid:${order.id}`,
      starts_at: planned.startsAt, ends_at: planned.endsAt,
    } });
    const paidOrder = await tx.membershipOrder.update({
      where: { id: order.id },
      data: {
        status: 'paid', paid_at: paidAt,
        membership_period_id: period.id, paid_payment_id: payment.id,
      },
    });
    await tx.membershipPayment.update({
      where: { id: payment.id },
      data: {
        trade_state: 'paid', transaction_id: paymentInfo.transaction_id,
        provider_success_at: paidAt, last_provider_error_code: null,
      },
    });
    await tx.auditLog.create({ data: {
      actor_user_id: order.user_id, action: 'annual_membership_paid',
      target_type: 'MembershipOrder', target_id: order.id,
      payload: {
        amount_cents: MEMBERSHIP_ANNUAL_PRICE_CENTS,
        membership_period_id: period.id,
        starts_at: period.starts_at.toISOString(), ends_at: period.ends_at.toISOString(),
        out_trade_no: payment.out_trade_no,
      },
    } });
    return mapPaidResult(paidOrder, period);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await execute();
      if ('exception' in result) {
        throw new MembershipPolicyError(result.exception, '会员费支付异常，需人工退款', 409);
      }
      return result;
    } catch (error) {
      if (!isPrismaCode(error, 'P2034') && !isPrismaCode(error, 'P2002')) throw error;
      const replay = await prisma.membershipOrder.findUnique({
        where: { id: membershipOrderId }, include: { membership_period: true },
      });
      if (replay?.status === 'paid' && replay.membership_period) {
        return mapPaidResult(replay, replay.membership_period);
      }
      if (attempt === 2) throw error;
    }
  }
  throw new Error('MEMBERSHIP_PAYMENT_RETRY_EXHAUSTED');
}

const TERMINAL_MEMBERSHIP_PAYMENT_EXCEPTIONS = new Set([
  'MEMBERSHIP_DUPLICATE_CHARGE_REQUIRES_REFUND',
  'MEMBERSHIP_SUSPENDED_AFTER_INITIALIZATION',
  'MEMBERSHIP_PAYMENT_EXCEPTION_REQUIRES_REFUND',
]);

export async function markMembershipOrderPaidFromNotification(
  membershipOrderId: string,
  paymentInfo: PaymentInfo,
) {
  try {
    return await markMembershipOrderPaid(membershipOrderId, paymentInfo);
  } catch (error) {
    if (error instanceof MembershipPolicyError && TERMINAL_MEMBERSHIP_PAYMENT_EXCEPTIONS.has(error.code)) {
      return { manual_refund_required: true, code: error.code };
    }
    throw error;
  }
}

export function createPrismaMembershipPaymentLookup(client: typeof prisma = prisma) {
  return {
    findByOutTradeNo(outTradeNoValue: string) {
      return client.membershipPayment.findUnique({
        where: { out_trade_no: outTradeNoValue },
        include: { membership_order: { include: { user: true } } },
      });
    },
  };
}
