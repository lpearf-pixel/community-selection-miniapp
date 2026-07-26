import { Prisma } from '@prisma/client';

type DbClient = Prisma.TransactionClient;

export type WithdrawalTaxPatch = {
  tax_mode: string;
  tax_status: string;
  taxable_amount_cents: number;
  tax_amount_cents: number;
  payable_amount_cents: number;
  tax_rate_basis: string | null;
  invoice_required: boolean;
  invoice_status: string;
  tax_remark: string | null;
};

export async function createWithdrawal(
  tx: DbClient,
  input: {
    leader_user_id: string;
    client_request_id: string;
    amount_cents: number;
  },
) {
  return tx.withdrawal.create({
    data: {
      leader_user_id: input.leader_user_id,
      client_request_id: input.client_request_id,
      amount_cents: input.amount_cents,
      status: 'pending',
      taxable_amount_cents: input.amount_cents,
      tax_amount_cents: 0,
      payable_amount_cents: input.amount_cents,
      tax_mode: 'pending_review',
      tax_status: 'pending',
      invoice_required: false,
      invoice_status: 'not_required',
    },
  });
}

export async function linkWithdrawalCommissions(
  tx: DbClient,
  input: {
    withdrawal_id: string;
    commissions: Array<{ id: string; amount_cents: number }>;
  },
) {
  const result = await tx.withdrawalCommission.createMany({
    data: input.commissions.map((commission) => ({
      withdrawal_id: input.withdrawal_id,
      commission_id: commission.id,
      amount_cents: commission.amount_cents,
    })),
  });
  if (result.count !== input.commissions.length) {
    throw new Error('提现关联奖励状态已变化，请人工复核');
  }
}

export async function loadWithdrawalReplaySnapshot(
  client: DbClient,
  input: { client_request_id: string },
) {
  return client.withdrawal.findUnique({
    where: { client_request_id: input.client_request_id },
    include: {
      commission_links: {
        select: {
          commission_id: true,
          amount_cents: true,
        },
        orderBy: { commission_id: 'asc' },
      },
    },
  });
}

export async function lockWithdrawal(tx: DbClient, withdrawalId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
      FROM "Withdrawal"
      WHERE "id" = ${withdrawalId}
      FOR UPDATE
    `,
  );
  if (rows.length !== 1) return null;
  return tx.withdrawal.findUnique({
    where: { id: withdrawalId },
    include: {
      commission_links: {
        include: {
          commission: {
            include: { order: true },
          },
        },
      },
    },
  });
}

export async function applyWithdrawalTaxPatch(
  tx: DbClient,
  input: {
    withdrawal_id: string;
    expected_version: number;
    reviewed_by_admin_id: string;
    patch: WithdrawalTaxPatch;
  },
) {
  const claimed = await tx.withdrawal.updateMany({
    where: {
      id: input.withdrawal_id,
      version: input.expected_version,
    },
    data: {
      ...input.patch,
      reviewed_by_admin_id: input.reviewed_by_admin_id,
      reviewed_at: new Date(),
      version: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    throw new Error('提现状态已变化，请刷新后重试');
  }
  return tx.withdrawal.findUniqueOrThrow({
    where: { id: input.withdrawal_id },
  });
}

export async function transitionWithdrawal(
  tx: DbClient,
  input: {
    withdrawal_id: string;
    expected_version: number;
    action: 'approve' | 'reject' | 'mark-paid';
    admin_user_id: string;
    admin_remark: string;
    manual_reference?: string;
  },
) {
  const now = new Date();
  const status =
    input.action === 'approve'
      ? 'approved'
      : input.action === 'reject'
        ? 'rejected'
        : 'paid';
  const actionPatch =
    input.action === 'approve'
      ? {
          reviewed_by_admin_id: input.admin_user_id,
          reviewed_at: now,
        }
      : input.action === 'reject'
        ? {
            reviewed_by_admin_id: input.admin_user_id,
            reviewed_at: now,
            rejected_at: now,
          }
        : {
            processed_by_admin_id: input.admin_user_id,
            processed_at: now,
            manual_reference: input.manual_reference ?? null,
          };
  const claimed = await tx.withdrawal.updateMany({
    where: {
      id: input.withdrawal_id,
      version: input.expected_version,
    },
    data: {
      status,
      admin_remark: input.admin_remark,
      ...actionPatch,
      version: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    throw new Error('提现状态已变化，请刷新后重试');
  }
  return tx.withdrawal.findUniqueOrThrow({
    where: { id: input.withdrawal_id },
  });
}
