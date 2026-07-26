import { Prisma } from '@prisma/client';
import type { AdminWithdrawalTaxReviewCommand } from '../withdrawal/admin-withdrawal-tax-review-command.js';
import type { WithdrawalTaxPatch } from '../withdrawal/withdrawal-owner.js';

type DbClient = Prisma.TransactionClient;

function resolveTaxProjection(
  amountCents: number,
  command: AdminWithdrawalTaxReviewCommand,
): WithdrawalTaxPatch {
  if (command.taxable_amount_cents > amountCents) {
    throw new Error('应税金额不能超过提现金额');
  }
  if (command.tax_amount_cents > command.taxable_amount_cents) {
    throw new Error('税务金额不能超过应税金额');
  }
  const invoiceRequired = command.tax_mode === 'invoice';
  const invoiceStatus = invoiceRequired
    ? command.invoice_status ?? 'pending'
    : 'not_required';
  const taxStatus =
    command.tax_mode === 'none'
      ? 'completed'
      : command.tax_mode === 'withheld'
        ? 'calculated'
        : invoiceStatus === 'verified'
          ? 'completed'
          : 'pending_invoice';
  return {
    tax_mode: command.tax_mode,
    tax_status: taxStatus,
    taxable_amount_cents: command.taxable_amount_cents,
    tax_amount_cents: command.tax_amount_cents,
    payable_amount_cents: amountCents - command.tax_amount_cents,
    tax_rate_basis: command.tax_rate_basis ?? null,
    invoice_required: invoiceRequired,
    invoice_status: invoiceStatus,
    tax_remark: command.tax_remark ?? null,
  };
}

export async function reviewWithdrawalTax(
  tx: DbClient,
  input: {
    withdrawal: {
      id: string;
      leader_user_id: string;
      amount_cents: number;
    };
    command: AdminWithdrawalTaxReviewCommand;
    receipt_id: string;
  },
) {
  const withdrawalPatch = resolveTaxProjection(
    input.withdrawal.amount_cents,
    input.command,
  );
  const payload = {
    receipt_id: input.receipt_id,
    idempotency_key: input.command.idempotency_key,
    review_snapshot: withdrawalPatch,
  } satisfies Prisma.InputJsonObject;
  const record = await tx.taxRecord.upsert({
    where: {
      source_type_source_id: {
        source_type: 'withdrawal',
        source_id: input.withdrawal.id,
      },
    },
    update: {
      leader_user_id: input.withdrawal.leader_user_id,
      tax_mode: withdrawalPatch.tax_mode,
      tax_status: withdrawalPatch.tax_status,
      amount_cents: input.withdrawal.amount_cents,
      payload,
    },
    create: {
      leader_user_id: input.withdrawal.leader_user_id,
      source_type: 'withdrawal',
      source_id: input.withdrawal.id,
      tax_mode: withdrawalPatch.tax_mode,
      tax_status: withdrawalPatch.tax_status,
      amount_cents: input.withdrawal.amount_cents,
      payload,
    },
  });
  return {
    withdrawal_patch: withdrawalPatch,
    tax_record: record,
  };
}
