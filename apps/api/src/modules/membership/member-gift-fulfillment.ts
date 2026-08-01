import { randomUUID } from 'node:crypto';
import { Prisma, type MemberGiftClaimStatus } from '@prisma/client';
import { prisma } from '../../db.js';
import {
  ADMIN_SCOPE_FORBIDDEN,
  canAccessOrderDataScope,
  getScopedOrderWhere,
  type AdminAccessContext,
} from '../admin-access/admin-access-control.js';
import { GiftPolicyError, type GiftLossReason } from './member-gift-service.js';

export type GiftFulfillmentEvent =
  | 'delivery_started'
  | 'delivery_completed'
  | 'pickup_verified'
  | 'full_refund';

export type GiftFulfillmentAction =
  | 'none'
  | 'start_fulfillment'
  | 'deliver'
  | 'release'
  | 'write_off';

export class GiftFulfillmentBlockError extends Error {
  readonly code = 'MEMBER_GIFT_MANUAL_REFUND_REQUIRED';
  readonly statusCode = 409;

  constructor() {
    super('赠品已进入履约或已交付，全额退款需人工处理');
    this.name = 'GiftFulfillmentBlockError';
  }
}

export function giftEventForDeliveryStatus(
  status: 'pending_dispatch' | 'delivering' | 'delivered' | 'exception',
): GiftFulfillmentEvent | null {
  if (status === 'delivering') return 'delivery_started';
  if (status === 'delivered') return 'delivery_completed';
  return null;
}

export function isFullRemainingRefund(input: {
  payAmountCents: number;
  refundedCents: number;
  requestedCents: number;
}) {
  return input.requestedCents === input.payAmountCents - input.refundedCents;
}

export function planGiftFulfillmentTransition(input: {
  event: GiftFulfillmentEvent;
  claim: {
    status: MemberGiftClaimStatus;
    fulfillmentStartedAt: Date | null;
  } | null;
}): { action: GiftFulfillmentAction } {
  if (!input.claim) return { action: 'none' };

  if (input.event === 'full_refund') {
    if (
      input.claim.status === 'delivered' ||
      (input.claim.status === 'reserved' && input.claim.fulfillmentStartedAt)
    ) {
      throw new GiftFulfillmentBlockError();
    }
    return { action: input.claim.status === 'reserved' ? 'release' : 'none' };
  }

  if (input.claim.status !== 'reserved') return { action: 'none' };
  if (input.event === 'delivery_started') return { action: 'start_fulfillment' };
  return { action: 'deliver' };
}

type GiftActor =
  | { actorUserId: string; actorAdminUserId?: never }
  | { actorUserId?: never; actorAdminUserId: string };

type GiftCommandResult = {
  claim_id: string;
  status: MemberGiftClaimStatus;
  idempotent: boolean;
};

async function replayEvent(
  tx: Prisma.TransactionClient,
  input: {
    idempotencyKey: string;
    claimId: string;
    action: GiftFulfillmentAction;
    reason?: GiftLossReason;
  } & GiftActor,
): Promise<GiftCommandResult | null> {
  const event = await tx.memberGiftInventoryEvent.findUnique({
    where: { idempotency_key: input.idempotencyKey }, include: { claim: true },
  });
  if (!event) return null;
  const expectedType = input.action === 'start_fulfillment'
    ? 'fulfillment_start'
    : input.action === 'write_off'
      ? 'write_off'
      : input.action;
  if (
    event.claim_id !== input.claimId || event.event_type !== expectedType ||
    event.actor_user_id !== (input.actorUserId ?? null) ||
    event.actor_admin_user_id !== (input.actorAdminUserId ?? null) ||
    event.reason !== (input.reason ?? null)
  ) {
    throw new GiftPolicyError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他赠品命令');
  }
  return { claim_id: event.claim_id, status: event.claim.status, idempotent: true };
}

async function persistAction(
  tx: Prisma.TransactionClient,
  input: {
    claimId: string;
    action: GiftFulfillmentAction;
    idempotencyKey: string;
    now: Date;
    reason?: GiftLossReason;
    adminContext?: AdminAccessContext;
  } & GiftActor,
): Promise<GiftCommandResult> {
  const previous = await replayEvent(tx, input);
  if (previous) return previous;
  await tx.$queryRaw`SELECT id FROM "MemberGiftClaim" WHERE id = ${input.claimId} FOR UPDATE`;
  const afterLock = await replayEvent(tx, input);
  if (afterLock) return afterLock;
  const claim = await tx.memberGiftClaim.findUnique({
    where: { id: input.claimId }, include: { order: true },
  });
  if (!claim) throw new GiftPolicyError('GIFT_CLAIM_NOT_FOUND', '赠品领取记录不存在', 404);
  if (input.adminContext && !canAccessOrderDataScope(input.adminContext, claim.order)) {
    throw Object.assign(new Error(ADMIN_SCOPE_FORBIDDEN), {
      statusCode: 403,
      code: 'ADMIN_SCOPE_FORBIDDEN',
    });
  }
  if (claim.status !== 'reserved') throw new GiftPolicyError('GIFT_CLAIM_NOT_RESERVED', '赠品不在待领取状态');
  await tx.$queryRaw`SELECT id FROM "MemberGiftCampaign" WHERE id = ${claim.campaign_id} FOR UPDATE`;

  let nextStatus: MemberGiftClaimStatus = claim.status;
  let eventType: 'fulfillment_start' | 'deliver' | 'release' | 'write_off';
  if (input.action === 'start_fulfillment') {
    eventType = 'fulfillment_start';
    if (!claim.fulfillment_started_at) {
      await tx.memberGiftClaim.update({
        where: { id: claim.id }, data: { fulfillment_started_at: input.now },
      });
    }
  } else {
    nextStatus = input.action === 'deliver'
      ? 'delivered'
      : input.action === 'release'
        ? 'released'
        : 'written_off';
    eventType = input.action === 'deliver'
      ? 'deliver'
      : input.action === 'release'
        ? 'release'
        : 'write_off';
    const campaignData = input.action === 'release'
      ? { inventory_reserved: { decrement: claim.quantity } }
      : input.action === 'deliver'
        ? { inventory_reserved: { decrement: claim.quantity }, inventory_delivered: { increment: claim.quantity } }
        : { inventory_reserved: { decrement: claim.quantity }, inventory_written_off: { increment: claim.quantity } };
    await tx.memberGiftCampaign.update({ where: { id: claim.campaign_id }, data: campaignData });
    await tx.memberGiftClaim.update({
      where: { id: claim.id },
      data: {
        status: nextStatus,
        released_at: nextStatus === 'released' ? input.now : undefined,
        delivered_at: nextStatus === 'delivered' ? input.now : undefined,
        written_off_at: nextStatus === 'written_off' ? input.now : undefined,
        loss_reason: input.reason,
      },
    });
  }
  await tx.memberGiftInventoryEvent.create({ data: {
    id: randomUUID(), campaign_id: claim.campaign_id, claim_id: claim.id,
    actor_user_id: input.actorUserId, actor_admin_user_id: input.actorAdminUserId,
    event_type: eventType, quantity: claim.quantity,
    idempotency_key: input.idempotencyKey, reason: input.reason,
  } });
  return { claim_id: claim.id, status: nextStatus, idempotent: false };
}

export async function applyOrderGiftFulfillmentEvent(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    event: GiftFulfillmentEvent;
    idempotencyKey: string;
    now: Date;
  } & GiftActor,
): Promise<GiftCommandResult | null> {
  const claim = await tx.memberGiftClaim.findUnique({ where: { order_id: input.orderId } });
  const plan = planGiftFulfillmentTransition({
    event: input.event,
    claim: claim ? { status: claim.status, fulfillmentStartedAt: claim.fulfillment_started_at } : null,
  });
  if (!claim || plan.action === 'none') return null;
  return persistAction(tx, { ...input, claimId: claim.id, action: plan.action });
}

async function executeAdminClaimAction(input: {
  claimId: string;
  context: AdminAccessContext;
  idempotencyKey: string;
  action: 'deliver' | 'write_off';
  reason?: GiftLossReason;
}) {
  const command = {
    claimId: input.claimId,
    actorAdminUserId: input.context.admin_user_id,
    adminContext: input.context,
    idempotencyKey: input.idempotencyKey,
    action: input.action,
    reason: input.reason,
    now: new Date(),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => persistAction(tx, command),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable = !!error && typeof error === 'object' && 'code' in error &&
        (error.code === 'P2034' || error.code === 'P2002');
      if (!retryable) throw error;
      const previous = await prisma.$transaction((tx) => replayEvent(tx, command));
      if (previous) return previous;
      if (attempt === 2) throw error;
    }
  }
  throw new Error('ADMIN_GIFT_COMMAND_RETRY_EXHAUSTED');
}

export function createAdminMemberGiftService() {
  return {
    async list(input: { status?: string; context: AdminAccessContext }) {
      const allowed = new Set<MemberGiftClaimStatus>(['reserved', 'released', 'delivered', 'written_off']);
      const status = input.status && allowed.has(input.status as MemberGiftClaimStatus)
        ? input.status as MemberGiftClaimStatus
        : undefined;
      const orderScope = getScopedOrderWhere(input.context);
      if (orderScope === null) return { items: [] };
      const items = await prisma.memberGiftClaim.findMany({
        where: { ...(status ? { status } : {}), order: orderScope },
        include: { campaign: { include: { gift_product: true } }, user: true, order: true },
        orderBy: { created_at: 'desc' }, take: 100,
      });
      return { items: items.map((item) => ({
        claim_id: item.id, order_id: item.order_id, order_no: item.order.order_no,
        user_id: item.user_id, user_nickname: item.user.nickname,
        campaign_id: item.campaign_id, campaign_name: item.campaign.name,
        gift_product_name: item.campaign.gift_product.name, status: item.status,
        fulfillment_started_at: item.fulfillment_started_at,
        created_at: item.created_at,
      })) };
    },
    deliver(input: { claimId: string; context: AdminAccessContext; idempotencyKey: string }) {
      return executeAdminClaimAction({ ...input, action: 'deliver' });
    },
    writeOff(input: {
      claimId: string; context: AdminAccessContext; idempotencyKey: string; reason: GiftLossReason;
    }) {
      return executeAdminClaimAction({ ...input, action: 'write_off' });
    },
  };
}
