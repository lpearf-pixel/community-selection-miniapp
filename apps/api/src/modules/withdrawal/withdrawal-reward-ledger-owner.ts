import type { Prisma } from '@prisma/client';
import {
  appendRewardLedgerEntry,
  getAvailableRewardBalance,
} from '../../services/commission-service.js';

type DbClient = Prisma.TransactionClient;

function ledgerNet(
  entries: Array<{ direction: string; amount_cents: number }>,
) {
  return entries.reduce(
    (sum, entry) =>
      sum + (entry.direction === 'in' ? entry.amount_cents : -entry.amount_cents),
    0,
  );
}

export async function validateWithdrawalRewardBalance(
  tx: DbClient,
  input: {
    leader_user_id: string;
    commissions: Array<{ id: string; amount_cents: number }>;
    amount_cents: number;
  },
) {
  for (const commission of input.commissions) {
    const entries = await tx.rewardLedger.findMany({
      where: {
        leader_user_id: input.leader_user_id,
        commission_id: commission.id,
        affects_available_balance: true,
      },
      select: { direction: true, amount_cents: true },
    });
    if (ledgerNet(entries) !== commission.amount_cents) {
      throw new Error('奖励账本待人工复核');
    }
  }
  const available = await getAvailableRewardBalance(
    tx,
    input.leader_user_id,
  );
  if (available < input.amount_cents) {
    throw new Error('奖励账本待人工复核');
  }
}

export async function validateReservedWithdrawalReward(
  tx: DbClient,
  input: { withdrawal_id: string; amount_cents: number },
) {
  const [reserved, restored] = await Promise.all([
    tx.rewardLedger.aggregate({
      where: {
        withdrawal_id: input.withdrawal_id,
        event_type: 'withdrawal_reserved',
        direction: 'out',
        affects_available_balance: true,
      },
      _sum: { amount_cents: true },
    }),
    tx.rewardLedger.aggregate({
      where: {
        withdrawal_id: input.withdrawal_id,
        event_type: 'withdrawal_rejected_restore',
        direction: 'in',
        affects_available_balance: true,
      },
      _sum: { amount_cents: true },
    }),
  ]);
  if (
    reserved._sum.amount_cents !== input.amount_cents ||
    (restored._sum.amount_cents ?? 0) !== 0
  ) {
    throw new Error('提现预留奖励账本不一致，请人工复核');
  }
}

function appendWithdrawalReward(
  tx: DbClient,
  input: {
    leader_user_id: string;
    withdrawal_id: string;
    amount_cents: number;
    event_type:
      | 'withdrawal_reserved'
      | 'withdrawal_rejected_restore'
      | 'withdrawal_paid';
    direction: 'in' | 'out';
    affects_available_balance: boolean;
    idempotency_key: string;
  },
) {
  return appendRewardLedgerEntry(tx, {
    leader_user_id: input.leader_user_id,
    withdrawal_id: input.withdrawal_id,
    event_type: input.event_type,
    entry_type: input.event_type,
    direction: input.direction,
    amount_cents: input.amount_cents,
    affects_available_balance: input.affects_available_balance,
    idempotency_key: input.idempotency_key,
  });
}

export function reserveWithdrawalReward(
  tx: DbClient,
  input: {
    leader_user_id: string;
    withdrawal_id: string;
    amount_cents: number;
  },
) {
  return appendWithdrawalReward(tx, {
    ...input,
    event_type: 'withdrawal_reserved',
    direction: 'out',
    affects_available_balance: true,
    idempotency_key: `withdrawal-reserved:${input.withdrawal_id}`,
  });
}

export function restoreRejectedWithdrawalReward(
  tx: DbClient,
  input: {
    leader_user_id: string;
    withdrawal_id: string;
    amount_cents: number;
  },
) {
  return appendWithdrawalReward(tx, {
    ...input,
    event_type: 'withdrawal_rejected_restore',
    direction: 'in',
    affects_available_balance: true,
    idempotency_key: `withdrawal-rejected-restore:${input.withdrawal_id}`,
  });
}

export function recordPaidWithdrawalReward(
  tx: DbClient,
  input: {
    leader_user_id: string;
    withdrawal_id: string;
    amount_cents: number;
  },
) {
  return appendWithdrawalReward(tx, {
    ...input,
    event_type: 'withdrawal_paid',
    direction: 'out',
    affects_available_balance: false,
    idempotency_key: `withdrawal-paid:${input.withdrawal_id}`,
  });
}
