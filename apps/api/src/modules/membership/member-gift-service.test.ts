import { describe, expect, it, vi } from 'vitest';
import {
  GiftPolicyError,
  claimGift,
  markGiftDelivered,
  releaseUncollectedGift,
  writeOffGiftLoss,
  type GiftPorts,
} from './member-gift-service.js';

const now = new Date('2026-07-31T00:00:00.000Z');
const activeMembership = { active: true as const, accountId: 'account-1', periodId: 'period-1' };

function ports(overrides: Partial<GiftPorts> = {}): GiftPorts {
  return {
    findCommandResult: vi.fn().mockResolvedValue(null),
    getCampaign: vi.fn().mockResolvedValue({
      id: 'campaign-1', status: 'active', startsAt: new Date('2026-07-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-31T00:00:00.000Z'), maxClaimsPerMember: 1,
      inventoryTotal: 10, inventoryReserved: 2, inventoryDelivered: 3, inventoryWrittenOff: 1,
    }),
    countConsumingClaims: vi.fn().mockResolvedValue(0),
    getGiftOrder: vi.fn().mockResolvedValue({
      id: 'order-1', userId: 'user-1', payStatus: 'paid', orderStatus: 'paid',
    }),
    reserveClaim: vi.fn().mockResolvedValue({ claimId: 'claim-1', status: 'reserved', idempotent: false }),
    getClaim: vi.fn().mockResolvedValue({
      id: 'claim-1', userId: 'user-1', campaignId: 'campaign-1', status: 'reserved', quantity: 1,
      fulfillmentStartedAt: null,
    }),
    transitionClaim: vi.fn().mockImplementation(async (input) => ({
      claimId: input.claimId, status: input.nextStatus, idempotent: false,
    })),
    ...overrides,
  };
}

describe('claimGift', () => {
  const input = {
    enabled: true, userId: 'user-1', orderId: 'order-1', campaignId: 'campaign-1', quantity: 1,
    idempotencyKey: 'gift-claim-1', now, membership: activeMembership,
  };

  it('rejects inactive membership and a disabled feature', async () => {
    await expect(claimGift({ ...input, enabled: false }, ports())).rejects.toMatchObject({ code: 'MEMBERSHIP_DISABLED' });
    await expect(claimGift({ ...input, membership: { active: false as const } }, ports())).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
  });

  it.each([
    [{ status: 'inactive' }, 'GIFT_CAMPAIGN_UNAVAILABLE'],
    [{ startsAt: new Date('2026-08-01T00:00:00.000Z') }, 'GIFT_CAMPAIGN_NOT_STARTED'],
    [{ endsAt: now }, 'GIFT_CAMPAIGN_ENDED'],
    [{ inventoryTotal: 6 }, 'GIFT_INVENTORY_INSUFFICIENT'],
  ])('rejects unavailable campaign %#', async (change, code) => {
    const repository = ports({ getCampaign: vi.fn().mockResolvedValue({
      id: 'campaign-1', status: 'active', startsAt: new Date('2026-07-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-31T00:00:00.000Z'), maxClaimsPerMember: 1,
      inventoryTotal: 10, inventoryReserved: 2, inventoryDelivered: 3, inventoryWrittenOff: 1,
      ...change,
    }) });
    await expect(claimGift(input, repository)).rejects.toMatchObject({ code });
    expect(repository.reserveClaim).not.toHaveBeenCalled();
  });

  it('enforces the per-member claim limit', async () => {
    await expect(claimGift(input, ports({ countConsumingClaims: vi.fn().mockResolvedValue(1) })))
      .rejects.toMatchObject({ code: 'GIFT_CLAIM_LIMIT_REACHED' });
  });

  it.each([
    [{ userId: 'user-2' }, 'GIFT_ORDER_OWNER_MISMATCH'],
    [{ payStatus: 'unpaid' }, 'GIFT_ORDER_UNAVAILABLE'],
    [{ orderStatus: 'refunded' }, 'GIFT_ORDER_UNAVAILABLE'],
  ])('rejects an ineligible gift fulfillment order %#', async (change, code) => {
    const repository = ports({
      getGiftOrder: vi.fn().mockResolvedValue({
        id: 'order-1', userId: 'user-1', payStatus: 'paid', orderStatus: 'paid', ...change,
      }),
    });
    await expect(claimGift(input, repository)).rejects.toMatchObject({ code });
    expect(repository.reserveClaim).not.toHaveBeenCalled();
  });

  it('returns the original command result without reserving twice', async () => {
    const repository = ports({
      findCommandResult: vi.fn().mockResolvedValue({ claimId: 'claim-1', status: 'reserved', idempotent: true }),
    });
    await expect(claimGift(input, repository)).resolves.toMatchObject({ idempotent: true });
    expect(repository.reserveClaim).not.toHaveBeenCalled();
  });
});

describe('gift claim transitions', () => {
  const command = { enabled: true, userId: 'user-1', claimId: 'claim-1', idempotencyKey: 'command-1', now };

  it('releases only an uncollected reservation and restores eligibility', async () => {
    const repository = ports();
    await expect(releaseUncollectedGift(command, repository)).resolves.toMatchObject({ status: 'released' });
    expect(repository.transitionClaim).toHaveBeenCalledWith(expect.objectContaining({
      nextStatus: 'released', inventoryEffect: 'release', restoresEligibility: true,
    }));
  });

  it('marks a reservation delivered without restoring eligibility', async () => {
    const repository = ports();
    await markGiftDelivered(command, repository);
    expect(repository.transitionClaim).toHaveBeenCalledWith(expect.objectContaining({
      nextStatus: 'delivered', inventoryEffect: 'deliver', restoresEligibility: false,
    }));
  });

  it.each(['damaged', 'lost', 'unsellable'] as const)('writes off %s without creating stock', async (reason) => {
    const repository = ports();
    await writeOffGiftLoss({ ...command, reason }, repository);
    expect(repository.transitionClaim).toHaveBeenCalledWith(expect.objectContaining({
      nextStatus: 'written_off', inventoryEffect: 'write_off', restoresEligibility: false, reason,
    }));
  });

  it('rejects another user and invalid terminal transitions', async () => {
    await expect(markGiftDelivered(command, ports({
      getClaim: vi.fn().mockResolvedValue({ id: 'claim-1', userId: 'user-2', campaignId: 'campaign-1', status: 'reserved', quantity: 1, fulfillmentStartedAt: null }),
    }))).rejects.toBeInstanceOf(GiftPolicyError);
    await expect(releaseUncollectedGift(command, ports({
      getClaim: vi.fn().mockResolvedValue({ id: 'claim-1', userId: 'user-1', campaignId: 'campaign-1', status: 'delivered', quantity: 1, fulfillmentStartedAt: null }),
    }))).rejects.toMatchObject({ code: 'GIFT_CLAIM_NOT_RESERVED' });
  });

  it('does not let the user release a gift after fulfillment starts', async () => {
    await expect(releaseUncollectedGift(command, ports({
      getClaim: vi.fn().mockResolvedValue({
        id: 'claim-1', userId: 'user-1', campaignId: 'campaign-1', status: 'reserved', quantity: 1,
        fulfillmentStartedAt: new Date('2026-07-31T00:30:00.000Z'),
      }),
    }))).rejects.toMatchObject({ code: 'GIFT_FULFILLMENT_STARTED' });
  });
});
