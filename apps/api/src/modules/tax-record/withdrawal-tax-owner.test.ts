import { describe, expect, it } from 'vitest';
import { reviewWithdrawalTax } from './withdrawal-tax-owner.js';

describe('withdrawal tax owner', () => {
  it('upserts a minimal tax record and returns an explicit withdrawal patch', async () => {
    let upsert: unknown;
    const tx = {
      taxRecord: {
        upsert: async (args: unknown) => {
          upsert = args;
          return { id: 'tax-1' };
        },
      },
    };
    const result = await reviewWithdrawalTax(tx as never, {
      withdrawal: {
        id: 'withdrawal-1',
        leader_user_id: 'leader-1',
        amount_cents: 3200,
      },
      command: {
        idempotency_key: 'tax-review-request-0001',
        expected_version: 2,
        tax_mode: 'withheld',
        taxable_amount_cents: 3200,
        tax_amount_cents: 320,
        tax_rate_basis: '10%',
        tax_remark: '人工复核',
      },
      receipt_id: 'receipt-1',
    });
    expect(result.withdrawal_patch).toEqual({
      tax_mode: 'withheld',
      tax_status: 'calculated',
      taxable_amount_cents: 3200,
      tax_amount_cents: 320,
      payable_amount_cents: 2880,
      tax_rate_basis: '10%',
      invoice_required: false,
      invoice_status: 'not_required',
      tax_remark: '人工复核',
    });
    expect(upsert).toMatchObject({
      where: {
        source_type_source_id: {
          source_type: 'withdrawal',
          source_id: 'withdrawal-1',
        },
      },
      create: {
        leader_user_id: 'leader-1',
        source_type: 'withdrawal',
        source_id: 'withdrawal-1',
        tax_mode: 'withheld',
        tax_status: 'calculated',
        amount_cents: 3200,
        payload: {
          receipt_id: 'receipt-1',
          idempotency_key: 'tax-review-request-0001',
          review_snapshot: {
            tax_mode: 'withheld',
            tax_status: 'calculated',
            taxable_amount_cents: 3200,
            tax_amount_cents: 320,
            payable_amount_cents: 2880,
            tax_rate_basis: '10%',
            invoice_required: false,
            invoice_status: 'not_required',
            tax_remark: '人工复核',
          },
        },
      },
    });
  });

  it('fails before writing when amounts exceed the withdrawal', async () => {
    let writes = 0;
    const tx = {
      taxRecord: {
        upsert: async () => {
          writes += 1;
          return {};
        },
      },
    };
    await expect(
      reviewWithdrawalTax(tx as never, {
        withdrawal: {
          id: 'withdrawal-1',
          leader_user_id: 'leader-1',
          amount_cents: 1000,
        },
        command: {
          idempotency_key: 'tax-review-request-0001',
          expected_version: 2,
          tax_mode: 'withheld',
          taxable_amount_cents: 1200,
          tax_amount_cents: 100,
        },
        receipt_id: 'receipt-1',
      }),
    ).rejects.toThrow('应税金额不能超过提现金额');
    expect(writes).toBe(0);
  });

  it('derives invoice and completed states without caller overrides', async () => {
    const tx = { taxRecord: { upsert: async () => ({ id: 'tax-1' }) } };
    const invoice = await reviewWithdrawalTax(tx as never, {
      withdrawal: {
        id: 'withdrawal-1',
        leader_user_id: 'leader-1',
        amount_cents: 1000,
      },
      command: {
        idempotency_key: 'tax-review-request-0001',
        expected_version: 2,
        tax_mode: 'invoice',
        taxable_amount_cents: 1000,
        tax_amount_cents: 0,
        invoice_status: 'verified',
      },
      receipt_id: 'receipt-1',
    });
    expect(invoice.withdrawal_patch).toMatchObject({
      tax_status: 'completed',
      invoice_required: true,
      invoice_status: 'verified',
    });
  });
});
