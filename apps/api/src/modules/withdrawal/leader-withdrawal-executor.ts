import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import {
  recordBusinessEvent,
  recordOrderTimeline,
  safeRaiseOpsAlert,
} from '../audit/audit-service.js';
import type { LeaderWithdrawalCommand } from './leader-withdrawal-command.js';
import {
  claimCommissionsForWithdrawal,
  lockWithdrawableCommissions,
} from './withdrawal-commission-owner.js';
import {
  createWithdrawal,
  linkWithdrawalCommissions,
  loadWithdrawalReplaySnapshot,
} from './withdrawal-owner.js';
import {
  reserveWithdrawalReward,
  validateWithdrawalRewardBalance,
} from './withdrawal-reward-ledger-owner.js';

export type LeaderWithdrawalCommandErrorCode =
  | 'LEADER_WITHDRAWAL_INVALID'
  | 'LEADER_WITHDRAWAL_CONFLICT'
  | 'LEADER_WITHDRAWAL_IDEMPOTENCY_CONFLICT'
  | 'LEADER_WITHDRAWAL_LEDGER_CONFLICT'
  | 'LEADER_WITHDRAWAL_EXECUTION_FAILED';

export class LeaderWithdrawalCommandError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: LeaderWithdrawalCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LeaderWithdrawalCommandError';
  }
}

type ReplaySnapshot = {
  id: string;
  leader_user_id: string;
  client_request_id: string | null;
  amount_cents: number;
  status: string;
  created_at: Date;
  reviewed_at: Date | null;
  processed_at: Date | null;
  manual_reference: string | null;
  commission_links: Array<{
    commission_id: string;
    amount_cents: number;
  }>;
};

function statusText(status: string) {
  return (
    {
      pending: '待审核',
      approved: '已通过',
      rejected: '已拒绝',
      paid: '已处理',
    }[status] ?? status
  );
}

function leaderResult(
  withdrawal: ReplaySnapshot,
  input: { idempotent: boolean; applied: boolean },
) {
  return {
    withdrawal_id: withdrawal.id,
    client_request_id: withdrawal.client_request_id,
    amount_cents: withdrawal.amount_cents,
    status: withdrawal.status,
    status_text: statusText(withdrawal.status),
    commission_count: withdrawal.commission_links.length,
    created_at: withdrawal.created_at,
    reviewed_at: withdrawal.reviewed_at,
    processed_at: withdrawal.processed_at,
    rejection_reason:
      withdrawal.status === 'rejected'
        ? '提现申请未通过，请联系平台'
        : undefined,
    manual_reference_masked: withdrawal.manual_reference
      ? withdrawal.manual_reference.length <= 6
        ? '***'
        : `${withdrawal.manual_reference.slice(0, 2)}***${withdrawal.manual_reference.slice(-2)}`
      : null,
    ...input,
  };
}

export function assertLeaderWithdrawalReplay(
  existing: ReplaySnapshot,
  input: {
    leader_user_id: string;
    command: LeaderWithdrawalCommand;
  },
) {
  const persistedIds = existing.commission_links
    .map((link) => link.commission_id)
    .sort((left, right) => left.localeCompare(right));
  const requestedIds = [...input.command.commission_ids].sort((left, right) =>
    left.localeCompare(right),
  );
  const sameIds =
    persistedIds.length === requestedIds.length &&
    persistedIds.every((id, index) => id === requestedIds[index]);
  if (
    existing.leader_user_id !== input.leader_user_id ||
    !sameIds ||
    (input.command.amount_cents !== undefined &&
      input.command.amount_cents !== existing.amount_cents)
  ) {
    throw new LeaderWithdrawalCommandError(
      409,
      'LEADER_WITHDRAWAL_IDEMPOTENCY_CONFLICT',
      'client_request_id 已被其他提现命令使用',
    );
  }
  return leaderResult(existing, { idempotent: true, applied: false });
}

function isPrismaCode(error: unknown, code: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

export async function executeLeaderWithdrawalCommand(input: {
  leader_user_id: string;
  command: LeaderWithdrawalCommand;
}) {
  const replay = async () => {
    const existing = await loadWithdrawalReplaySnapshot(prisma as never, {
      client_request_id: input.command.client_request_id,
    });
    if (!existing) {
      throw new LeaderWithdrawalCommandError(
        500,
        'LEADER_WITHDRAWAL_EXECUTION_FAILED',
        '提交提现申请失败',
      );
    }
    return assertLeaderWithdrawalReplay(existing, input);
  };
  const existing = await loadWithdrawalReplaySnapshot(prisma as never, {
    client_request_id: input.command.client_request_id,
  });
  if (existing) return assertLeaderWithdrawalReplay(existing, input);

  try {
    return await prisma.$transaction(async (tx) => {
      const commissions = await lockWithdrawableCommissions(tx, {
        leader_user_id: input.leader_user_id,
        commission_ids: input.command.commission_ids,
      });
      const amount = commissions.reduce(
        (sum, commission) => sum + commission.final_amount_cents,
        0,
      );
      if (
        input.command.amount_cents !== undefined &&
        input.command.amount_cents !== amount
      ) {
        throw new LeaderWithdrawalCommandError(
          400,
          'LEADER_WITHDRAWAL_INVALID',
          '提现金额必须精确匹配整笔开团服务奖励合计',
        );
      }
      await validateWithdrawalRewardBalance(tx, {
        leader_user_id: input.leader_user_id,
        commissions: commissions.map((commission) => ({
          id: commission.id,
          amount_cents: commission.final_amount_cents,
        })),
        amount_cents: amount,
      });
      const withdrawal = await createWithdrawal(tx, {
        leader_user_id: input.leader_user_id,
        client_request_id: input.command.client_request_id,
        amount_cents: amount,
      });
      const commissionIds = commissions.map((commission) => commission.id);
      await claimCommissionsForWithdrawal(tx, {
        withdrawal_id: withdrawal.id,
        commission_ids: commissionIds,
      });
      await linkWithdrawalCommissions(tx, {
        withdrawal_id: withdrawal.id,
        commissions: commissions.map((commission) => ({
          id: commission.id,
          amount_cents: commission.final_amount_cents,
        })),
      });
      await reserveWithdrawalReward(tx, {
        leader_user_id: input.leader_user_id,
        withdrawal_id: withdrawal.id,
        amount_cents: amount,
      });
      const orderIds = [
        ...new Set(commissions.map((commission) => commission.order_id)),
      ];
      const payload = {
        withdrawal_id: withdrawal.id,
        amount_cents: amount,
        commission_ids: commissionIds,
        order_ids: orderIds,
        action: 'withdrawal_requested',
        status: withdrawal.status,
      };
      await recordBusinessEvent(tx, {
        event_type: 'withdrawal_requested',
        event_source: 'leader-withdrawal-executor',
        withdrawal_id: withdrawal.id,
        leader_user_id: input.leader_user_id,
        after_snapshot: withdrawal,
        payload,
      });
      for (const orderId of orderIds) {
        await recordBusinessEvent(tx, {
          event_type: 'withdrawal_requested',
          event_source: 'leader-withdrawal-executor',
          order_id: orderId,
          withdrawal_id: withdrawal.id,
          leader_user_id: input.leader_user_id,
          after_snapshot: withdrawal,
          payload,
        });
        await recordOrderTimeline(tx, {
          order_id: orderId,
          event_type: 'withdrawal_requested',
          title: '开团服务奖励提现申请已提交',
          payload: {
            withdrawal_id: withdrawal.id,
            amount_cents: amount,
            status: withdrawal.status,
          },
        });
      }
      return leaderResult(
        {
          ...withdrawal,
          commission_links: commissions.map((commission) => ({
            commission_id: commission.id,
            amount_cents: commission.final_amount_cents,
          })),
        },
        { idempotent: false, applied: true },
      );
    });
  } catch (error) {
    if (isPrismaCode(error, 'P2002')) return replay();
    if (isPrismaCode(error, 'P2034')) {
      throw new LeaderWithdrawalCommandError(
        409,
        'LEADER_WITHDRAWAL_CONFLICT',
        '开团服务奖励状态已变化，请刷新后重试',
      );
    }
    if (error instanceof LeaderWithdrawalCommandError) throw error;
    if (
      error instanceof Error &&
      [
        '存在不可提现或已占用的开团服务奖励',
        '提现关联奖励状态已变化，请人工复核',
      ].includes(error.message)
    ) {
      throw new LeaderWithdrawalCommandError(
        409,
        'LEADER_WITHDRAWAL_CONFLICT',
        error.message,
      );
    }
    if (error instanceof Error && error.message === '奖励账本待人工复核') {
      await safeRaiseOpsAlert(prisma, {
        alert_type: 'withdrawal_reward_ledger_mismatch',
        alert_level: 'critical',
        leader_user_id: input.leader_user_id,
        title: '提现奖励账本待人工复核',
        message: '奖励账本与提现申请不一致',
        payload: {
          commission_ids: input.command.commission_ids,
        },
      });
      throw new LeaderWithdrawalCommandError(
        409,
        'LEADER_WITHDRAWAL_LEDGER_CONFLICT',
        error.message,
      );
    }
    throw new LeaderWithdrawalCommandError(
      500,
      'LEADER_WITHDRAWAL_EXECUTION_FAILED',
      '提交提现申请失败',
    );
  }
}
