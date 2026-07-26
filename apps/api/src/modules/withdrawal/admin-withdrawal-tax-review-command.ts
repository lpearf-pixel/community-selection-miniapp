import { createHash } from 'node:crypto';

export type AdminWithdrawalTaxReviewCommand = {
  idempotency_key: string;
  expected_version: number;
  tax_mode: 'none' | 'withheld' | 'invoice';
  taxable_amount_cents: number;
  tax_amount_cents: number;
  tax_rate_basis?: string;
  invoice_status?: 'pending' | 'verified' | 'rejected';
  tax_remark?: string;
};

type ParseResult =
  | { ok: true; value: AdminWithdrawalTaxReviewCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_WITHDRAWAL_TAX_REVIEW_COMMAND';
      message: string;
    };

const ALLOWED_KEYS = new Set([
  'idempotency_key',
  'expected_version',
  'tax_mode',
  'taxable_amount_cents',
  'tax_amount_cents',
  'tax_rate_basis',
  'invoice_status',
  'tax_remark',
]);
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const MAX_INT = 2_147_483_647;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function invalid(): ParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_WITHDRAWAL_TAX_REVIEW_COMMAND',
    message: '提现税务复核命令不合法',
  };
}

function optionalText(
  value: unknown,
  maximumLength: number,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (
    text.length === 0 ||
    text.length > maximumLength ||
    CONTROL_CHARACTER.test(text)
  ) {
    return null;
  }
  return text;
}

export function parseAdminWithdrawalTaxReviewCommand(
  input: unknown,
): ParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalid();
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    return invalid();
  }
  if (
    typeof body.idempotency_key !== 'string' ||
    body.idempotency_key !== body.idempotency_key.trim() ||
    !IDEMPOTENCY_KEY.test(body.idempotency_key) ||
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 0
  ) {
    return invalid();
  }
  const taxMode = body.tax_mode;
  if (!['none', 'withheld', 'invoice'].includes(String(taxMode))) {
    return invalid();
  }
  const taxable = body.taxable_amount_cents;
  const tax = body.tax_amount_cents;
  if (
    !Number.isSafeInteger(taxable) ||
    Number(taxable) < 0 ||
    Number(taxable) > MAX_INT ||
    !Number.isSafeInteger(tax) ||
    Number(tax) < 0 ||
    Number(tax) > MAX_INT ||
    Number(tax) > Number(taxable) ||
    (taxMode === 'none' && Number(tax) !== 0)
  ) {
    return invalid();
  }
  const rateBasis = optionalText(body.tax_rate_basis, 100);
  const taxRemark = optionalText(body.tax_remark, 500);
  if (rateBasis === null || taxRemark === null) return invalid();

  let invoiceStatus:
    | 'pending'
    | 'verified'
    | 'rejected'
    | undefined;
  if (taxMode === 'invoice') {
    invoiceStatus =
      body.invoice_status === undefined
        ? 'pending'
        : (body.invoice_status as typeof invoiceStatus);
    if (!['pending', 'verified', 'rejected'].includes(String(invoiceStatus))) {
      return invalid();
    }
  } else if (body.invoice_status !== undefined) {
    return invalid();
  }

  return {
    ok: true,
    value: {
      idempotency_key: body.idempotency_key,
      expected_version: Number(body.expected_version),
      tax_mode: taxMode as AdminWithdrawalTaxReviewCommand['tax_mode'],
      taxable_amount_cents: Number(taxable),
      tax_amount_cents: Number(tax),
      ...(rateBasis ? { tax_rate_basis: rateBasis } : {}),
      invoice_status: invoiceStatus,
      ...(taxRemark ? { tax_remark: taxRemark } : {}),
    },
  };
}

export function buildAdminWithdrawalTaxReviewRequestHash(input: {
  withdrawal_id: string;
  command: AdminWithdrawalTaxReviewCommand;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: 'admin.withdrawal.tax-review.v1',
        withdrawal_id: input.withdrawal_id,
        expected_version: input.command.expected_version,
        tax_mode: input.command.tax_mode,
        taxable_amount_cents: input.command.taxable_amount_cents,
        tax_amount_cents: input.command.tax_amount_cents,
        tax_rate_basis: input.command.tax_rate_basis ?? null,
        invoice_status: input.command.invoice_status ?? null,
        tax_remark: input.command.tax_remark ?? null,
      }),
    )
    .digest('hex');
}
