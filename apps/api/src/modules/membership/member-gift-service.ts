export type GiftClaimStatus = 'reserved' | 'released' | 'delivered' | 'written_off';
export type GiftInventoryEffect = 'reserve' | 'release' | 'deliver' | 'write_off';
export type GiftLossReason = 'damaged' | 'lost' | 'unsellable';

export class GiftPolicyError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
    this.name = 'GiftPolicyError';
  }
}

export type GiftCampaignRecord = {
  id: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  maxClaimsPerMember: number;
  inventoryTotal: number;
  inventoryReserved: number;
  inventoryDelivered: number;
  inventoryWrittenOff: number;
};

export type GiftClaimRecord = {
  id: string;
  userId: string;
  campaignId: string;
  status: GiftClaimStatus;
  quantity: number;
  fulfillmentStartedAt: Date | null;
};

export type GiftCommandResult = {
  claimId: string;
  status: GiftClaimStatus;
  idempotent: boolean;
};

export type GiftCommandIdentity =
  | {
      operation: 'reserve'; userId: string; orderId: string; campaignId: string;
      membershipAccountId: string; membershipPeriodId: string; quantity: number;
    }
  | {
      operation: 'release' | 'deliver' | 'write_off'; userId: string;
      claimId: string; reason?: GiftLossReason;
    };

export type GiftPorts = {
  findCommandResult(idempotencyKey: string, identity: GiftCommandIdentity): Promise<GiftCommandResult | null>;
  getCampaign(id: string): Promise<GiftCampaignRecord | null>;
  countConsumingClaims(campaignId: string, membershipAccountId: string): Promise<number>;
  getGiftOrder(id: string): Promise<{
    id: string; userId: string; payStatus: string; orderStatus: string;
  } | null>;
  reserveClaim(input: {
    userId: string;
    orderId: string;
    membershipAccountId: string;
    membershipPeriodId: string;
    campaignId: string;
    quantity: number;
    idempotencyKey: string;
    now: Date;
  }): Promise<GiftCommandResult>;
  getClaim(id: string): Promise<GiftClaimRecord | null>;
  transitionClaim(input: {
    claimId: string;
    userId: string;
    idempotencyKey: string;
    nextStatus: GiftClaimStatus;
    inventoryEffect: Exclude<GiftInventoryEffect, 'reserve'>;
    restoresEligibility: boolean;
    reason?: GiftLossReason;
    now: Date;
  }): Promise<GiftCommandResult>;
};

function requireEnabled(enabled: boolean) {
  if (!enabled) throw new GiftPolicyError('MEMBERSHIP_DISABLED', '会员赠品功能尚未启用', 503);
}

function requireCommandInput(input: { userId: string; idempotencyKey: string; now: Date }) {
  if (!input.userId.trim() || !input.idempotencyKey.trim() || Number.isNaN(input.now.getTime())) {
    throw new GiftPolicyError('GIFT_COMMAND_INVALID', '赠品命令参数无效', 400);
  }
}

export async function claimGift(input: {
  enabled: boolean;
  userId: string;
  orderId: string;
  campaignId: string;
  quantity: number;
  idempotencyKey: string;
  now: Date;
  membership: { active: true; accountId: string; periodId: string } | { active: false };
}, ports: GiftPorts): Promise<GiftCommandResult> {
  requireEnabled(input.enabled);
  requireCommandInput(input);
  if (!input.membership.active) {
    throw new GiftPolicyError('MEMBERSHIP_REQUIRED', '仅有效会员可领取赠品', 403);
  }
  if (!input.campaignId.trim() || !input.orderId.trim() || !Number.isSafeInteger(input.quantity) || input.quantity !== 1) {
    throw new GiftPolicyError('GIFT_CLAIM_INVALID', '赠品领取参数无效', 400);
  }
  const identity: GiftCommandIdentity = {
    operation: 'reserve', userId: input.userId, orderId: input.orderId,
    campaignId: input.campaignId, membershipAccountId: input.membership.accountId,
    membershipPeriodId: input.membership.periodId, quantity: input.quantity,
  };
  const previous = await ports.findCommandResult(input.idempotencyKey, identity);
  if (previous) return { ...previous, idempotent: true };

  const campaign = await ports.getCampaign(input.campaignId);
  if (!campaign || campaign.status !== 'active') {
    throw new GiftPolicyError('GIFT_CAMPAIGN_UNAVAILABLE', '赠品活动不可用');
  }
  if (input.now < campaign.startsAt) {
    throw new GiftPolicyError('GIFT_CAMPAIGN_NOT_STARTED', '赠品活动尚未开始');
  }
  if (input.now >= campaign.endsAt) {
    throw new GiftPolicyError('GIFT_CAMPAIGN_ENDED', '赠品活动已结束');
  }
  const consumed = await ports.countConsumingClaims(input.campaignId, input.membership.accountId);
  if (consumed >= campaign.maxClaimsPerMember) {
    throw new GiftPolicyError('GIFT_CLAIM_LIMIT_REACHED', '本期赠品领取次数已用完');
  }
  const available = campaign.inventoryTotal
    - campaign.inventoryReserved
    - campaign.inventoryDelivered
    - campaign.inventoryWrittenOff;
  if (available < input.quantity) {
    throw new GiftPolicyError('GIFT_INVENTORY_INSUFFICIENT', '赠品库存不足');
  }
  const order = await ports.getGiftOrder(input.orderId);
  if (!order) throw new GiftPolicyError('GIFT_ORDER_UNAVAILABLE', '赠品履约订单不可用', 404);
  if (order.userId !== input.userId) {
    throw new GiftPolicyError('GIFT_ORDER_OWNER_MISMATCH', '赠品履约订单不属于当前用户', 403);
  }
  if (order.payStatus !== 'paid' || ['unpaid', 'closed', 'refunded'].includes(order.orderStatus)) {
    throw new GiftPolicyError('GIFT_ORDER_UNAVAILABLE', '赠品履约订单不可用');
  }
  return ports.reserveClaim({
    userId: input.userId,
    orderId: input.orderId,
    membershipAccountId: input.membership.accountId,
    membershipPeriodId: input.membership.periodId,
    campaignId: input.campaignId,
    quantity: input.quantity,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
  });
}

async function transitionReservedClaim(
  input: { enabled: boolean; userId: string; claimId: string; idempotencyKey: string; now: Date },
  ports: GiftPorts,
  transition: {
    nextStatus: Exclude<GiftClaimStatus, 'reserved'>;
    inventoryEffect: Exclude<GiftInventoryEffect, 'reserve'>;
    restoresEligibility: boolean;
    reason?: GiftLossReason;
  },
) {
  requireEnabled(input.enabled);
  requireCommandInput(input);
  const identity: GiftCommandIdentity = {
    operation: transition.inventoryEffect, userId: input.userId,
    claimId: input.claimId, reason: transition.reason,
  };
  const previous = await ports.findCommandResult(input.idempotencyKey, identity);
  if (previous) return { ...previous, idempotent: true };
  const claim = await ports.getClaim(input.claimId);
  if (!claim) throw new GiftPolicyError('GIFT_CLAIM_NOT_FOUND', '赠品领取记录不存在', 404);
  if (claim.userId !== input.userId) throw new GiftPolicyError('GIFT_CLAIM_OWNER_MISMATCH', '赠品不属于当前用户', 403);
  if (claim.status !== 'reserved') throw new GiftPolicyError('GIFT_CLAIM_NOT_RESERVED', '赠品不在待领取状态');
  if (transition.restoresEligibility && claim.fulfillmentStartedAt) {
    throw new GiftPolicyError('GIFT_FULFILLMENT_STARTED', '赠品已进入履约，不能由用户取消');
  }
  return ports.transitionClaim({
    claimId: input.claimId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
    ...transition,
  });
}

export function releaseUncollectedGift(
  input: { enabled: boolean; userId: string; claimId: string; idempotencyKey: string; now: Date },
  ports: GiftPorts,
) {
  return transitionReservedClaim(input, ports, {
    nextStatus: 'released', inventoryEffect: 'release', restoresEligibility: true,
  });
}

export function markGiftDelivered(
  input: { enabled: boolean; userId: string; claimId: string; idempotencyKey: string; now: Date },
  ports: GiftPorts,
) {
  return transitionReservedClaim(input, ports, {
    nextStatus: 'delivered', inventoryEffect: 'deliver', restoresEligibility: false,
  });
}

export function writeOffGiftLoss(
  input: {
    enabled: boolean; userId: string; claimId: string; idempotencyKey: string;
    now: Date; reason: GiftLossReason;
  },
  ports: GiftPorts,
) {
  return transitionReservedClaim(input, ports, {
    nextStatus: 'written_off', inventoryEffect: 'write_off', restoresEligibility: false,
    reason: input.reason,
  });
}
