import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildAdminWithdrawalTaxReviewRequestHash,
  parseAdminWithdrawalTaxReviewCommand,
} from './admin-withdrawal-tax-review-command.js';

const valid = {
  idempotency_key: 'tax-review-request-0001',
  expected_version: 3,
  tax_mode: 'withheld',
  taxable_amount_cents: 3000,
  tax_amount_cents: 300,
  tax_rate_basis: 'manual 10%',
  tax_remark: '人工复核',
};

describe('parseAdminWithdrawalTaxReviewCommand', () => {
  it('normalizes optional text and derives non-invoice defaults', () => {
    expect(parseAdminWithdrawalTaxReviewCommand(valid)).toEqual({
      ok: true,
      value: {
        ...valid,
        invoice_status: undefined,
      },
    });
  });

  it('accepts invoice mode only with a valid invoice state', () => {
    expect(
      parseAdminWithdrawalTaxReviewCommand({
        ...valid,
        tax_mode: 'invoice',
        tax_amount_cents: 0,
        invoice_status: 'verified',
      }),
    ).toMatchObject({
      ok: true,
      value: { tax_mode: 'invoice', invoice_status: 'verified' },
    });
  });

  it('defaults an omitted invoice state to pending', () => {
    expect(
      parseAdminWithdrawalTaxReviewCommand({
        ...valid,
        tax_mode: 'invoice',
        tax_amount_cents: 0,
      }),
    ).toMatchObject({
      ok: true,
      value: { tax_mode: 'invoice', invoice_status: 'pending' },
    });
  });

  it.each([
    null,
    [],
    { ...valid, unknown: true },
    { ...valid, idempotency_key: 'short' },
    { ...valid, idempotency_key: `bad\n${'x'.repeat(20)}` },
    { ...valid, expected_version: -1 },
    { ...valid, expected_version: 1.5 },
    { ...valid, tax_mode: 'pending' },
    { ...valid, taxable_amount_cents: -1 },
    { ...valid, tax_amount_cents: -1 },
    { ...valid, tax_amount_cents: 3001 },
    { ...valid, tax_mode: 'none', tax_amount_cents: 1 },
    { ...valid, tax_mode: 'withheld', invoice_status: 'pending' },
    { ...valid, tax_mode: 'invoice', invoice_status: 'not_required' },
  ])('rejects an invalid tax command %#', (input) => {
    expect(parseAdminWithdrawalTaxReviewCommand(input)).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_WITHDRAWAL_TAX_REVIEW_COMMAND',
      message: '提现税务复核命令不合法',
    });
  });
});

describe('buildAdminWithdrawalTaxReviewRequestHash', () => {
  it('includes operation, target, version, and the normalized tax command', () => {
    const command = parseAdminWithdrawalTaxReviewCommand(valid);
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          operation: 'admin.withdrawal.tax-review.v1',
          withdrawal_id: 'withdrawal-1',
          expected_version: 3,
          tax_mode: 'withheld',
          taxable_amount_cents: 3000,
          tax_amount_cents: 300,
          tax_rate_basis: 'manual 10%',
          invoice_status: null,
          tax_remark: '人工复核',
        }),
      )
      .digest('hex');

    expect(
      buildAdminWithdrawalTaxReviewRequestHash({
        withdrawal_id: 'withdrawal-1',
        command: command.value,
      }),
    ).toBe(expected);
  });
});
