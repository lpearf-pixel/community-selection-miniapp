import { randomUUID } from 'node:crypto';
import { Prisma, type MembershipPeriod } from '@prisma/client';
import { prisma } from '../../db.js';
import {
  MembershipPolicyError,
  evaluateMembershipEntitlement,
  type MembershipActivationPorts,
  type MembershipActivationResult,
  type PersistLegacyActivationInput,
} from './membership-lifecycle.js';

function mapActivation(period: MembershipPeriod, idempotent: boolean): MembershipActivationResult {
  return {
    accountId: period.account_id,
    periodId: period.id,
    userId: period.user_id,
    eligibilityId: period.source === 'legacy_free' ? period.source_id : null,
    startsAt: period.starts_at,
    endsAt: period.ends_at,
    source: period.source,
    idempotent,
  };
}

export class PrismaMembershipRepository implements MembershipActivationPorts {
  async findActivationByIdempotencyKey(key: string) {
    const period = await prisma.membershipPeriod.findUnique({ where: { idempotency_key: key } });
    return period ? mapActivation(period, true) : null;
  }

  async getLegacyEligibility(id: string) {
    const eligibility = await prisma.legacyMemberEligibility.findUnique({ where: { id } });
    return eligibility ? {
      id: eligibility.id,
      userId: eligibility.user_id,
      grantType: eligibility.grant_type,
      status: eligibility.status,
    } : null;
  }

  async persistLegacyActivation(input: PersistLegacyActivationInput) {
    const execute = () => prisma.$transaction(async (tx) => {
      const existing = await tx.membershipPeriod.findUnique({
        where: { idempotency_key: input.idempotencyKey },
      });
      if (existing) {
        if (existing.user_id !== input.userId || existing.source_id !== input.eligibilityId) {
          throw new MembershipPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他会员激活');
        }
        return mapActivation(existing, true);
      }

      await tx.$queryRaw`SELECT id FROM "LegacyMemberEligibility" WHERE id = ${input.eligibilityId} FOR UPDATE`;
      const afterLock = await tx.membershipPeriod.findUnique({
        where: { idempotency_key: input.idempotencyKey },
      });
      if (afterLock) {
        if (afterLock.user_id !== input.userId || afterLock.source_id !== input.eligibilityId) {
          throw new MembershipPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他会员激活');
        }
        return mapActivation(afterLock, true);
      }
      const eligibility = await tx.legacyMemberEligibility.findUnique({ where: { id: input.eligibilityId } });
      if (!eligibility || eligibility.status !== 'active') {
        throw new MembershipPolicyError('LEGACY_ELIGIBILITY_UNAVAILABLE', '老会员首年免费资格不可用');
      }
      if (eligibility.user_id !== input.userId || eligibility.grant_type !== 'LEGACY_FIRST_YEAR_FREE') {
        throw new MembershipPolicyError('LEGACY_ELIGIBILITY_INVALID', '老会员首年免费资格不匹配', 403);
      }

      const currentAccount = await tx.membershipAccount.findUnique({ where: { user_id: input.userId } });
      if (currentAccount?.status === 'active' && currentAccount.ends_at > input.startsAt) {
        throw new MembershipPolicyError('MEMBERSHIP_ALREADY_ACTIVE', '当前会员仍在有效期内');
      }

      const account = currentAccount
        ? await tx.membershipAccount.update({
            where: { id: currentAccount.id },
            data: { status: 'active', starts_at: input.startsAt, ends_at: input.endsAt, suspension_reason: null },
          })
        : await tx.membershipAccount.create({
            data: {
              id: randomUUID(), user_id: input.userId, status: 'active',
              starts_at: input.startsAt, ends_at: input.endsAt,
            },
          });
      const period = await tx.membershipPeriod.create({
        data: {
          id: randomUUID(), account_id: account.id, user_id: input.userId,
          source: 'legacy_free', source_id: input.eligibilityId,
          idempotency_key: input.idempotencyKey, starts_at: input.startsAt, ends_at: input.endsAt,
        },
      });
      const consumed = await tx.legacyMemberEligibility.updateMany({
        where: { id: input.eligibilityId, user_id: input.userId, status: 'active', membership_period_id: null },
        data: { status: 'used', used_at: input.startsAt, membership_period_id: period.id },
      });
      if (consumed.count !== 1) {
        throw new MembershipPolicyError('LEGACY_ELIGIBILITY_CONCURRENTLY_USED', '老会员资格已被使用');
      }
      await tx.auditLog.create({
        data: {
          actor_user_id: input.userId,
          action: 'legacy_membership_activated',
          target_type: 'MembershipPeriod',
          target_id: period.id,
          payload: {
            eligibility_id: input.eligibilityId,
            starts_at: input.startsAt.toISOString(),
            ends_at: input.endsAt.toISOString(),
            idempotency_key: input.idempotencyKey,
          },
        },
      });
      return mapActivation(period, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await execute();
      } catch (error) {
        const retryable = !!error && typeof error === 'object' && 'code' in error &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable) throw error;
        const previous = await prisma.membershipPeriod.findUnique({
          where: { idempotency_key: input.idempotencyKey },
        });
        if (previous) {
          if (previous.user_id !== input.userId || previous.source_id !== input.eligibilityId) {
            throw new MembershipPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他会员激活');
          }
          return mapActivation(previous, true);
        }
        if (attempt === 2) throw error;
      }
    }
    throw new Error('MEMBERSHIP_ACTIVATION_RETRY_EXHAUSTED');
  }
}

export async function getMembershipEntitlement(
  userId: string,
  now: Date,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const account = await client.membershipAccount.findUnique({ where: { user_id: userId } });
  if (!account) return evaluateMembershipEntitlement(null, now);
  const period = await client.membershipPeriod.findFirst({
    where: { account_id: account.id, starts_at: { lte: now }, ends_at: { gt: now } },
    orderBy: { ends_at: 'desc' },
  });
  return evaluateMembershipEntitlement(period ? {
    accountId: account.id,
    periodId: period.id,
    status: account.status,
    startsAt: period.starts_at,
    endsAt: period.ends_at,
  } : null, now);
}
