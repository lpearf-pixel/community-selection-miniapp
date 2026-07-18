import {
  CommissionStatus,
  GroupBuyStatus,
  OrderStatus,
  PayStatus,
  PickupType,
  WithdrawalStatus,
} from '@prisma/client';
import { prisma } from '../../db.js';
import type {
  CenterProfileRole,
  LeaderCenterSummary,
  MeCenterSummary,
  RewardLedgerDirectionGroup,
} from './me-center-types.js';

const PENDING_AFTER_SALE_STATUSES = ['submitted', 'reviewing', 'approved', 'processing'];
const PENDING_FULFILLMENT_STATUSES = [OrderStatus.paid, OrderStatus.grouped, OrderStatus.preparing];
const DELIVERY_ACTIVE_STATUSES = [OrderStatus.ready, OrderStatus.delivered];
const SUCCESS_GROUP_BUY_STATUSES = [
  GroupBuyStatus.success,
  GroupBuyStatus.preparing,
  GroupBuyStatus.ready,
  GroupBuyStatus.fulfilled,
];
const FAILED_GROUP_BUY_STATUSES = [GroupBuyStatus.failed, GroupBuyStatus.cancelled];
const PENDING_COMMISSION_STATUSES = [
  CommissionStatus.estimated,
  CommissionStatus.frozen,
  CommissionStatus.pending,
];
const WITHDRAWING_STATUSES = [WithdrawalStatus.pending, WithdrawalStatus.approved];

export function toCenterProfileRole(role: string): CenterProfileRole {
  return role === 'leader' ? 'leader' : 'user';
}

export function rewardBalanceFromGroups(groups: readonly RewardLedgerDirectionGroup[]): number {
  return groups.reduce((total, group) => {
    const amount = group._sum.amount_cents ?? 0;
    if (group.direction === 'in') return total + amount;
    if (group.direction === 'out') return total - amount;
    return total;
  }, 0);
}

export function withdrawalStatusText(status: string): string {
  const labels: Record<string, string> = {
    pending: '待审核',
    approved: '已通过，待线下处理',
    paid: '已处理',
    rejected: '已拒绝',
  };
  return labels[status] ?? status;
}

export async function getMeCenterSummary(userId: string): Promise<MeCenterSummary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nickname: true,
      avatar_url: true,
      role: true,
    },
  });
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
  }

  const [
    totalCount,
    unpaidCount,
    pendingFulfillmentCount,
    readyForPickupCount,
    inDeliveryCount,
    completedCount,
    pendingAfterSaleCount,
  ] = await Promise.all([
    prisma.order.count({ where: { user_id: userId } }),
    prisma.order.count({
      where: {
        user_id: userId,
        pay_status: PayStatus.unpaid,
        order_status: { not: OrderStatus.closed },
      },
    }),
    prisma.order.count({
      where: {
        user_id: userId,
        pay_status: PayStatus.paid,
        order_status: { in: PENDING_FULFILLMENT_STATUSES },
      },
    }),
    prisma.order.count({
      where: {
        user_id: userId,
        pickup_type: PickupType.store,
        order_status: OrderStatus.ready,
      },
    }),
    prisma.order.count({
      where: {
        user_id: userId,
        pickup_type: PickupType.delivery,
        order_status: { in: DELIVERY_ACTIVE_STATUSES },
      },
    }),
    prisma.order.count({ where: { user_id: userId, order_status: OrderStatus.completed } }),
    prisma.afterSaleCase.count({
      where: {
        user_id: userId,
        status: { in: PENDING_AFTER_SALE_STATUSES },
      },
    }),
  ]);

  return {
    profile: {
      user_id: user.id,
      nickname: user.nickname ?? null,
      avatar_url: user.avatar_url ?? null,
      role: toCenterProfileRole(user.role),
    },
    orders: {
      total_count: totalCount,
      unpaid_count: unpaidCount,
      pending_fulfillment_count: pendingFulfillmentCount,
      ready_for_pickup_count: readyForPickupCount,
      in_delivery_count: inDeliveryCount,
      completed_count: completedCount,
    },
    after_sales: {
      pending_count: pendingAfterSaleCount,
    },
    navigation: {
      leader_center_available: user.role === 'leader',
    },
    updated_at: new Date().toISOString(),
  };
}

export async function getLeaderCenterSummary(leaderUserId: string): Promise<LeaderCenterSummary> {
  const [
    totalGroupBuyCount,
    activeGroupBuyCount,
    successGroupBuyCount,
    failedGroupBuyCount,
    pendingCommissionAggregate,
    rewardLedgerGroups,
    withdrawingAggregate,
    withdrawnAggregate,
    pendingWithdrawalCount,
    approvedWithdrawalCount,
    rejectedWithdrawalCount,
    processedWithdrawalCount,
    latestWithdrawals,
  ] = await Promise.all([
    prisma.groupBuy.count({ where: { leader_user_id: leaderUserId } }),
    prisma.groupBuy.count({
      where: { leader_user_id: leaderUserId, status: GroupBuyStatus.pending },
    }),
    prisma.groupBuy.count({
      where: { leader_user_id: leaderUserId, status: { in: SUCCESS_GROUP_BUY_STATUSES } },
    }),
    prisma.groupBuy.count({
      where: { leader_user_id: leaderUserId, status: { in: FAILED_GROUP_BUY_STATUSES } },
    }),
    prisma.commission.aggregate({
      where: {
        leader_user_id: leaderUserId,
        status: { in: PENDING_COMMISSION_STATUSES },
      },
      _sum: { final_amount_cents: true },
    }),
    prisma.rewardLedger.groupBy({
      by: ['direction'],
      where: {
        leader_user_id: leaderUserId,
        affects_available_balance: true,
      },
      _sum: { amount_cents: true },
    }),
    prisma.withdrawal.aggregate({
      where: {
        leader_user_id: leaderUserId,
        status: { in: WITHDRAWING_STATUSES },
      },
      _sum: { amount_cents: true },
    }),
    prisma.withdrawal.aggregate({
      where: { leader_user_id: leaderUserId, status: WithdrawalStatus.paid },
      _sum: { amount_cents: true },
    }),
    prisma.withdrawal.count({
      where: { leader_user_id: leaderUserId, status: WithdrawalStatus.pending },
    }),
    prisma.withdrawal.count({
      where: { leader_user_id: leaderUserId, status: WithdrawalStatus.approved },
    }),
    prisma.withdrawal.count({
      where: { leader_user_id: leaderUserId, status: WithdrawalStatus.rejected },
    }),
    prisma.withdrawal.count({
      where: { leader_user_id: leaderUserId, status: WithdrawalStatus.paid },
    }),
    prisma.withdrawal.findMany({
      where: { leader_user_id: leaderUserId },
      select: {
        id: true,
        amount_cents: true,
        status: true,
        created_at: true,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 5,
    }),
  ]);

  return {
    group_buys: {
      total_count: totalGroupBuyCount,
      active_count: activeGroupBuyCount,
      success_count: successGroupBuyCount,
      failed_count: failedGroupBuyCount,
    },
    rewards: {
      pending_cents: pendingCommissionAggregate._sum.final_amount_cents ?? 0,
      available_cents: rewardBalanceFromGroups(rewardLedgerGroups),
      withdrawing_cents: withdrawingAggregate._sum.amount_cents ?? 0,
      withdrawn_cents: withdrawnAggregate._sum.amount_cents ?? 0,
    },
    withdrawals: {
      pending_count: pendingWithdrawalCount,
      approved_count: approvedWithdrawalCount,
      rejected_count: rejectedWithdrawalCount,
      processed_count: processedWithdrawalCount,
      latest: latestWithdrawals.map((item) => ({
        withdrawal_id: item.id,
        amount_cents: item.amount_cents,
        status: item.status,
        status_text: withdrawalStatusText(item.status),
        created_at: item.created_at.toISOString(),
      })),
    },
    navigation: {
      withdrawal_entry_available: true,
    },
    updated_at: new Date().toISOString(),
  };
}
