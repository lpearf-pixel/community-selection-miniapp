import { Prisma } from '@prisma/client';

type DbClient = Prisma.TransactionClient;

export type LockedWithdrawalCommission = {
  id: string;
  leader_user_id: string;
  order_id: string;
  group_buy_id: string;
  status: string;
  withdrawal_id: string | null;
  final_amount_cents: number;
};

export async function lockWithdrawableCommissions(
  tx: DbClient,
  input: {
    leader_user_id: string;
    commission_ids: string[];
  },
): Promise<LockedWithdrawalCommission[]> {
  const orderedIds = [...input.commission_ids].sort((left, right) =>
    left.localeCompare(right),
  );
  const locked: LockedWithdrawalCommission[] = [];
  for (const commissionId of orderedIds) {
    const rows = await tx.$queryRaw<LockedWithdrawalCommission[]>(
      Prisma.sql`
        SELECT
          "id",
          "leader_user_id",
          "order_id",
          "group_buy_id",
          "status"::text AS "status",
          "withdrawal_id",
          "final_amount_cents"
        FROM "Commission"
        WHERE "id" = ${commissionId}
        FOR UPDATE
      `,
    );
    const item = rows[0];
    if (
      !item ||
      item.leader_user_id !== input.leader_user_id ||
      item.status !== 'available' ||
      item.withdrawal_id !== null ||
      item.final_amount_cents <= 0
    ) {
      throw new Error('存在不可提现或已占用的开团服务奖励');
    }
    locked.push(item);
  }
  return locked;
}

async function requireCompleteTransition(
  tx: DbClient,
  input: {
    withdrawal_id: string;
    commission_ids: string[];
    from: 'available' | 'withdrawing';
    to: 'withdrawing' | 'available' | 'withdrawn';
  },
) {
  const claiming = input.from === 'available';
  const result = await tx.commission.updateMany({
    where: {
      id: { in: input.commission_ids },
      status: input.from,
      withdrawal_id: claiming ? null : input.withdrawal_id,
    },
    data: {
      status: input.to,
      withdrawal_id: input.to === 'available' ? null : input.withdrawal_id,
    },
  });
  if (result.count !== input.commission_ids.length) {
    throw new Error('提现关联奖励状态已变化，请人工复核');
  }
}

export function claimCommissionsForWithdrawal(
  tx: DbClient,
  input: { withdrawal_id: string; commission_ids: string[] },
) {
  return requireCompleteTransition(tx, {
    ...input,
    from: 'available',
    to: 'withdrawing',
  });
}

export function releaseCommissionsFromWithdrawal(
  tx: DbClient,
  input: { withdrawal_id: string; commission_ids: string[] },
) {
  return requireCompleteTransition(tx, {
    ...input,
    from: 'withdrawing',
    to: 'available',
  });
}

export function markCommissionsWithdrawn(
  tx: DbClient,
  input: { withdrawal_id: string; commission_ids: string[] },
) {
  return requireCompleteTransition(tx, {
    ...input,
    from: 'withdrawing',
    to: 'withdrawn',
  });
}
