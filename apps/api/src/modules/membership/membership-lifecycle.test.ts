import { describe, expect, it, vi } from 'vitest';
import {
  MembershipPolicyError,
  activateLegacyMembership,
  evaluateMembershipEntitlement,
  type MembershipActivationPorts,
} from './membership-lifecycle.js';

const now = new Date('2026-07-31T00:00:00.000Z');

function ports(overrides: Partial<MembershipActivationPorts> = {}): MembershipActivationPorts {
  return {
    findActivationByIdempotencyKey: vi.fn().mockResolvedValue(null),
    getLegacyEligibility: vi.fn().mockResolvedValue({
      id: 'eligibility-1',
      userId: 'user-1',
      grantType: 'LEGACY_FIRST_YEAR_FREE',
      status: 'active',
    }),
    persistLegacyActivation: vi.fn().mockImplementation(async (input) => ({
      accountId: 'account-1',
      periodId: 'period-1',
      userId: input.userId,
      eligibilityId: input.eligibilityId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      source: 'legacy_free' as const,
      idempotent: false,
    })),
    ...overrides,
  };
}

describe('activateLegacyMembership', () => {
  it('fails closed while membership is disabled', async () => {
    await expect(activateLegacyMembership({
      enabled: false,
      userId: 'user-1',
      eligibilityId: 'eligibility-1',
      idempotencyKey: 'legacy:user-1:eligibility-1',
      now,
    }, ports())).rejects.toMatchObject({ code: 'MEMBERSHIP_DISABLED' });
  });

  it.each([
    [{ status: 'revoked' }, 'LEGACY_ELIGIBILITY_UNAVAILABLE'],
    [{ status: 'used' }, 'LEGACY_ELIGIBILITY_UNAVAILABLE'],
    [{ userId: 'user-2' }, 'LEGACY_ELIGIBILITY_OWNER_MISMATCH'],
    [{ grantType: 'OTHER' }, 'LEGACY_ELIGIBILITY_TYPE_INVALID'],
  ])('rejects invalid legacy eligibility %#', async (change, code) => {
    const repository = ports({
      getLegacyEligibility: vi.fn().mockResolvedValue({
        id: 'eligibility-1',
        userId: 'user-1',
        grantType: 'LEGACY_FIRST_YEAR_FREE',
        status: 'active',
        ...change,
      }),
    });
    await expect(activateLegacyMembership({
      enabled: true,
      userId: 'user-1',
      eligibilityId: 'eligibility-1',
      idempotencyKey: 'legacy:user-1:eligibility-1',
      now,
    }, repository)).rejects.toMatchObject({ code });
    expect(repository.persistLegacyActivation).not.toHaveBeenCalled();
  });

  it('creates an exact 365-day period and forwards the idempotency key', async () => {
    const repository = ports();
    const result = await activateLegacyMembership({
      enabled: true,
      userId: 'user-1',
      eligibilityId: 'eligibility-1',
      idempotencyKey: 'legacy:user-1:eligibility-1',
      now,
    }, repository);

    expect(result.startsAt.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(result.endsAt.toISOString()).toBe('2027-07-31T00:00:00.000Z');
    expect(repository.persistLegacyActivation).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'legacy:user-1:eligibility-1',
    }));
  });

  it('returns an earlier successful activation without consuming eligibility again', async () => {
    const existing = {
      accountId: 'account-1',
      periodId: 'period-1',
      userId: 'user-1',
      eligibilityId: 'eligibility-1',
      startsAt: now,
      endsAt: new Date('2027-07-31T00:00:00.000Z'),
      source: 'legacy_free' as const,
      idempotent: true,
    };
    const repository = ports({
      findActivationByIdempotencyKey: vi.fn().mockResolvedValue(existing),
    });
    await expect(activateLegacyMembership({
      enabled: true,
      userId: 'user-1',
      eligibilityId: 'eligibility-1',
      idempotencyKey: 'legacy:user-1:eligibility-1',
      now,
    }, repository)).resolves.toEqual(existing);
    expect(repository.getLegacyEligibility).not.toHaveBeenCalled();
    expect(repository.persistLegacyActivation).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for another user', async () => {
    const repository = ports({
      findActivationByIdempotencyKey: vi.fn().mockResolvedValue({
        accountId: 'account-1', periodId: 'period-1', userId: 'user-2',
        eligibilityId: 'eligibility-1', startsAt: now,
        endsAt: new Date('2027-07-31T00:00:00.000Z'), source: 'legacy_free', idempotent: true,
      }),
    });
    await expect(activateLegacyMembership({
      enabled: true, userId: 'user-1', eligibilityId: 'eligibility-1',
      idempotencyKey: 'legacy:user-1:eligibility-1', now,
    }, repository)).rejects.toBeInstanceOf(MembershipPolicyError);
  });
});

describe('evaluateMembershipEntitlement', () => {
  const active = {
    accountId: 'account-1', periodId: 'period-1', status: 'active' as const,
    startsAt: now, endsAt: new Date('2027-07-31T00:00:00.000Z'),
  };

  it('is active only inside the half-open period', () => {
    expect(evaluateMembershipEntitlement(active, now).active).toBe(true);
    expect(evaluateMembershipEntitlement(active, new Date('2027-07-30T23:59:59.999Z')).active).toBe(true);
    expect(evaluateMembershipEntitlement(active, active.endsAt).active).toBe(false);
  });

  it.each(['suspended', 'expired'] as const)('rejects %s accounts', (status) => {
    expect(evaluateMembershipEntitlement({ ...active, status }, now)).toEqual({ active: false, reason: status });
  });
});
