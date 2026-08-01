import { randomUUID } from 'node:crypto';
import { Prisma, type MemberGiftCampaign, type MemberGiftClaim } from '@prisma/client';
import { prisma } from '../../db.js';
import {
  GiftPolicyError,
  type GiftCampaignRecord,
  type GiftClaimRecord,
  type GiftCommandResult,
  type GiftCommandIdentity,
  type GiftPorts,
} from './member-gift-service.js';

function prismaCode(error: unknown, code: string) {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

function assertEventIdentity(
  event: MemberGiftInventoryEventWithClaim,
  identity: GiftCommandIdentity,
) {
  const expectedType = identity.operation === 'reserve' ? 'reserve' : identity.operation;
  const sameActor = event.actor_user_id === identity.userId && event.actor_admin_user_id === null;
  const sameTarget = identity.operation === 'reserve'
    ? event.claim.order_id === identity.orderId &&
      event.claim.campaign_id === identity.campaignId &&
      event.claim.membership_account_id === identity.membershipAccountId &&
      event.claim.membership_period_id === identity.membershipPeriodId &&
      event.quantity === identity.quantity
    : event.claim_id === identity.claimId && event.reason === (identity.reason ?? null);
  if (event.event_type !== expectedType || !sameActor || !sameTarget) {
    throw new GiftPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他赠品命令');
  }
}

type MemberGiftInventoryEventWithClaim = Prisma.MemberGiftInventoryEventGetPayload<{
  include: { claim: true };
}>;

async function replay(
  client: Prisma.TransactionClient | typeof prisma,
  idempotencyKey: string,
  identity: GiftCommandIdentity,
) {
  const event = await client.memberGiftInventoryEvent.findUnique({
    where: { idempotency_key: idempotencyKey }, include: { claim: true },
  });
  if (!event) return null;
  assertEventIdentity(event, identity);
  return { claimId: event.claim_id, status: event.claim.status, idempotent: true } as GiftCommandResult;
}

async function runGiftCommand(
  idempotencyKey: string,
  identity: GiftCommandIdentity,
  operation: () => Promise<GiftCommandResult>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!prismaCode(error, 'P2034') && !prismaCode(error, 'P2002')) throw error;
      const previous = await replay(prisma, idempotencyKey, identity);
      if (previous) return previous;
      if (attempt === 2) throw error;
    }
  }
  throw new Error('GIFT_COMMAND_RETRY_EXHAUSTED');
}

function mapCampaign(value: MemberGiftCampaign): GiftCampaignRecord {
  return {
    id: value.id, status: value.status, startsAt: value.starts_at, endsAt: value.ends_at,
    maxClaimsPerMember: value.max_claims_per_member, inventoryTotal: value.inventory_total,
    inventoryReserved: value.inventory_reserved, inventoryDelivered: value.inventory_delivered,
    inventoryWrittenOff: value.inventory_written_off,
  };
}

function mapClaim(value: MemberGiftClaim): GiftClaimRecord {
  return {
    id: value.id, userId: value.user_id, campaignId: value.campaign_id,
    status: value.status, quantity: value.quantity,
    fulfillmentStartedAt: value.fulfillment_started_at,
  };
}

export class PrismaMemberGiftRepository implements GiftPorts {
  findCommandResult(idempotencyKey: string, identity: GiftCommandIdentity) {
    return replay(prisma, idempotencyKey, identity);
  }

  async getCampaign(id: string) {
    const campaign = await prisma.memberGiftCampaign.findUnique({ where: { id } });
    return campaign ? mapCampaign(campaign) : null;
  }

  countConsumingClaims(campaignId: string, membershipAccountId: string) {
    return prisma.memberGiftClaim.count({
      where: { campaign_id: campaignId, membership_account_id: membershipAccountId, status: { in: ['reserved', 'delivered', 'written_off'] } },
    });
  }

  async getGiftOrder(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, user_id: true, pay_status: true, order_status: true },
    });
    return order ? {
      id: order.id, userId: order.user_id, payStatus: order.pay_status,
      orderStatus: order.order_status,
    } : null;
  }

  async reserveClaim(input: Parameters<GiftPorts['reserveClaim']>[0]): Promise<GiftCommandResult> {
    const identity: GiftCommandIdentity = {
      operation: 'reserve', userId: input.userId, orderId: input.orderId,
      campaignId: input.campaignId, membershipAccountId: input.membershipAccountId,
      membershipPeriodId: input.membershipPeriodId, quantity: input.quantity,
    };
    return runGiftCommand(input.idempotencyKey, identity, () => prisma.$transaction(async (tx) => {
      const previous = await replay(tx, input.idempotencyKey, identity);
      if (previous) return previous;
      await tx.$queryRaw`SELECT id FROM "MemberGiftCampaign" WHERE id = ${input.campaignId} FOR UPDATE`;
      const afterLock = await replay(tx, input.idempotencyKey, identity);
      if (afterLock) return afterLock;
      const [campaign, account, period, consumed] = await Promise.all([
        tx.memberGiftCampaign.findUnique({ where: { id: input.campaignId } }),
        tx.membershipAccount.findUnique({ where: { id: input.membershipAccountId } }),
        tx.membershipPeriod.findUnique({ where: { id: input.membershipPeriodId } }),
        tx.memberGiftClaim.count({ where: { campaign_id: input.campaignId, membership_account_id: input.membershipAccountId, status: { in: ['reserved', 'delivered', 'written_off'] } } }),
      ]);
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, user_id: true, pay_status: true, order_status: true },
      });
      if (!campaign || campaign.status !== 'active' || input.now < campaign.starts_at || input.now >= campaign.ends_at) throw new GiftPolicyError('GIFT_CAMPAIGN_UNAVAILABLE', '赠品活动不可用');
      if (!account || account.user_id !== input.userId || account.status !== 'active' || input.now < account.starts_at || input.now >= account.ends_at) throw new GiftPolicyError('MEMBERSHIP_REQUIRED', '会员资格不可用', 403);
      if (!period || period.account_id !== account.id || period.user_id !== input.userId || input.now < period.starts_at || input.now >= period.ends_at) throw new GiftPolicyError('MEMBERSHIP_PERIOD_INVALID', '会员周期不可用', 403);
      if (consumed >= campaign.max_claims_per_member) throw new GiftPolicyError('GIFT_CLAIM_LIMIT_REACHED', '本期赠品领取次数已用完');
      if (!order || order.user_id !== input.userId || order.pay_status !== 'paid' || ['unpaid', 'closed', 'refunded'].includes(order.order_status)) {
        throw new GiftPolicyError('GIFT_ORDER_UNAVAILABLE', '赠品履约订单不可用');
      }
      const available = campaign.inventory_total - campaign.inventory_reserved - campaign.inventory_delivered - campaign.inventory_written_off;
      if (available < input.quantity) throw new GiftPolicyError('GIFT_INVENTORY_INSUFFICIENT', '赠品库存不足');
      const claim = await tx.memberGiftClaim.create({ data: {
        id: randomUUID(), campaign_id: input.campaignId, user_id: input.userId,
        order_id: input.orderId,
        membership_account_id: input.membershipAccountId, membership_period_id: input.membershipPeriodId,
        quantity: input.quantity, status: 'reserved', claim_idempotency_key: input.idempotencyKey,
      } });
      await tx.memberGiftCampaign.update({ where: { id: campaign.id }, data: { inventory_reserved: { increment: input.quantity } } });
      await tx.memberGiftInventoryEvent.create({ data: {
        id: randomUUID(), campaign_id: campaign.id, claim_id: claim.id, actor_user_id: input.userId,
        event_type: 'reserve', quantity: input.quantity, idempotency_key: input.idempotencyKey,
      } });
      return { claimId: claim.id, status: claim.status, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async getClaim(id: string) {
    const claim = await prisma.memberGiftClaim.findUnique({ where: { id } });
    return claim ? mapClaim(claim) : null;
  }

  async transitionClaim(input: Parameters<GiftPorts['transitionClaim']>[0]): Promise<GiftCommandResult> {
    const identity: GiftCommandIdentity = {
      operation: input.inventoryEffect, userId: input.userId,
      claimId: input.claimId, reason: input.reason,
    };
    return runGiftCommand(input.idempotencyKey, identity, () => prisma.$transaction(async (tx) => {
      const previous = await replay(tx, input.idempotencyKey, identity);
      if (previous) return previous;
      await tx.$queryRaw`SELECT id FROM "MemberGiftClaim" WHERE id = ${input.claimId} FOR UPDATE`;
      const afterLock = await replay(tx, input.idempotencyKey, identity);
      if (afterLock) return afterLock;
      const claim = await tx.memberGiftClaim.findUnique({ where: { id: input.claimId } });
      if (!claim) throw new GiftPolicyError('GIFT_CLAIM_NOT_FOUND', '赠品领取记录不存在', 404);
      if (claim.user_id !== input.userId) throw new GiftPolicyError('GIFT_CLAIM_OWNER_MISMATCH', '赠品不属于当前用户', 403);
      if (claim.status !== 'reserved') throw new GiftPolicyError('GIFT_CLAIM_NOT_RESERVED', '赠品不在待领取状态');
      if (input.restoresEligibility && claim.fulfillment_started_at) {
        throw new GiftPolicyError('GIFT_FULFILLMENT_STARTED', '赠品已进入履约，不能由用户取消');
      }
      await tx.$queryRaw`SELECT id FROM "MemberGiftCampaign" WHERE id = ${claim.campaign_id} FOR UPDATE`;
      const campaignData = input.inventoryEffect === 'release'
        ? { inventory_reserved: { decrement: claim.quantity } }
        : input.inventoryEffect === 'deliver'
          ? { inventory_reserved: { decrement: claim.quantity }, inventory_delivered: { increment: claim.quantity } }
          : { inventory_reserved: { decrement: claim.quantity }, inventory_written_off: { increment: claim.quantity } };
      await tx.memberGiftCampaign.update({ where: { id: claim.campaign_id }, data: campaignData });
      const updated = await tx.memberGiftClaim.update({ where: { id: claim.id }, data: {
        status: input.nextStatus,
        released_at: input.nextStatus === 'released' ? input.now : undefined,
        delivered_at: input.nextStatus === 'delivered' ? input.now : undefined,
        written_off_at: input.nextStatus === 'written_off' ? input.now : undefined,
        loss_reason: input.reason,
      } });
      await tx.memberGiftInventoryEvent.create({ data: {
        id: randomUUID(), campaign_id: claim.campaign_id, claim_id: claim.id, actor_user_id: input.userId,
        event_type: input.inventoryEffect, quantity: claim.quantity, idempotency_key: input.idempotencyKey, reason: input.reason,
      } });
      return { claimId: updated.id, status: updated.status, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }
}
