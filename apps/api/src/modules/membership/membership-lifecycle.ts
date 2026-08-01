const MEMBERSHIP_YEAR_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MembershipAccountStatus = 'active' | 'expired' | 'suspended';
export type MembershipPeriodSource = 'legacy_free' | 'annual_paid' | 'manual';

export type LegacyEligibility = {
  id: string;
  userId: string | null;
  grantType: string;
  status: string;
};

export type MembershipActivationResult = {
  accountId: string;
  periodId: string;
  userId: string;
  eligibilityId: string | null;
  startsAt: Date;
  endsAt: Date;
  source: MembershipPeriodSource;
  idempotent: boolean;
};

export type PersistLegacyActivationInput = {
  userId: string;
  eligibilityId: string;
  idempotencyKey: string;
  startsAt: Date;
  endsAt: Date;
};

export type MembershipActivationPorts = {
  findActivationByIdempotencyKey(key: string): Promise<MembershipActivationResult | null>;
  getLegacyEligibility(id: string): Promise<LegacyEligibility | null>;
  persistLegacyActivation(input: PersistLegacyActivationInput): Promise<MembershipActivationResult>;
};

export class MembershipPolicyError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
    this.name = 'MembershipPolicyError';
  }
}

function requireNonEmpty(value: string, code: string, label: string) {
  if (!value.trim()) throw new MembershipPolicyError(code, `${label}不能为空`, 400);
}

export async function activateLegacyMembership(
  input: {
    enabled: boolean;
    userId: string;
    eligibilityId: string;
    idempotencyKey: string;
    now: Date;
  },
  ports: MembershipActivationPorts,
): Promise<MembershipActivationResult> {
  if (!input.enabled) {
    throw new MembershipPolicyError('MEMBERSHIP_DISABLED', '会员功能尚未启用', 503);
  }
  requireNonEmpty(input.userId, 'MEMBERSHIP_USER_REQUIRED', '用户');
  requireNonEmpty(input.eligibilityId, 'LEGACY_ELIGIBILITY_REQUIRED', '老会员资格');
  requireNonEmpty(input.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', '幂等键');
  if (Number.isNaN(input.now.getTime())) {
    throw new MembershipPolicyError('MEMBERSHIP_TIME_INVALID', '会员激活时间无效', 400);
  }

  const existing = await ports.findActivationByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    if (existing.userId !== input.userId || existing.eligibilityId !== input.eligibilityId) {
      throw new MembershipPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他会员激活');
    }
    return { ...existing, idempotent: true };
  }

  const eligibility = await ports.getLegacyEligibility(input.eligibilityId);
  if (!eligibility || eligibility.status !== 'active') {
    throw new MembershipPolicyError('LEGACY_ELIGIBILITY_UNAVAILABLE', '老会员首年免费资格不可用');
  }
  if (eligibility.grantType !== 'LEGACY_FIRST_YEAR_FREE') {
    throw new MembershipPolicyError('LEGACY_ELIGIBILITY_TYPE_INVALID', '资格类型不是老会员首年免费');
  }
  if (eligibility.userId !== input.userId) {
    throw new MembershipPolicyError('LEGACY_ELIGIBILITY_OWNER_MISMATCH', '资格不属于当前用户', 403);
  }

  const startsAt = new Date(input.now);
  const endsAt = new Date(startsAt.getTime() + MEMBERSHIP_YEAR_DAYS * DAY_MS);
  return ports.persistLegacyActivation({
    userId: input.userId,
    eligibilityId: input.eligibilityId,
    idempotencyKey: input.idempotencyKey,
    startsAt,
    endsAt,
  });
}

export type MembershipEntitlement =
  | { active: true; accountId: string; periodId: string; startsAt: Date; endsAt: Date }
  | { active: false; reason: 'missing' | 'not_started' | 'expired' | 'suspended' };

export function evaluateMembershipEntitlement(
  record: {
    accountId: string;
    periodId: string;
    status: MembershipAccountStatus;
    startsAt: Date;
    endsAt: Date;
  } | null,
  now: Date,
): MembershipEntitlement {
  if (!record) return { active: false, reason: 'missing' };
  if (record.status === 'suspended') return { active: false, reason: 'suspended' };
  if (record.status === 'expired' || now >= record.endsAt) return { active: false, reason: 'expired' };
  if (now < record.startsAt) return { active: false, reason: 'not_started' };
  return {
    active: true,
    accountId: record.accountId,
    periodId: record.periodId,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
  };
}
