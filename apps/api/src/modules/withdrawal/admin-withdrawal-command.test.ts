import { describe, expect, it } from 'vitest';
import {
  buildAdminWithdrawalRequestHash,
  parseAdminWithdrawalCommand,
} from './admin-withdrawal-command.js';

describe('Admin withdrawal command contract', () => {
  it.each(['approve', 'reject'] as const)(
    'parses %s without accepting money or state overrides',
    (action) => {
      const parsed = parseAdminWithdrawalCommand(action, {
        expected_version: 1,
        idempotency_key: `admin-withdrawal-${action}-0001`,
        admin_remark: '人工审核确认',
      });
      expect(parsed).toEqual({
        ok: true,
        value: {
          expected_version: 1,
          idempotency_key: `admin-withdrawal-${action}-0001`,
          admin_remark: '人工审核确认',
        },
      });
      expect(
        parseAdminWithdrawalCommand(action, {
          expected_version: 1,
          idempotency_key: `admin-withdrawal-${action}-0001`,
          admin_remark: '人工审核确认',
          amount_cents: 1,
        }),
      ).toMatchObject({ ok: false });
    },
  );

  it('requires a manual reference only for mark-paid', () => {
    const parsed = parseAdminWithdrawalCommand('mark-paid', {
      expected_version: 3,
      idempotency_key: 'admin-withdrawal-paid-0001',
      admin_remark: '线下转账完成',
      manual_reference: 'BANK-20260725-0001',
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        expected_version: 3,
        manual_reference: 'BANK-20260725-0001',
      },
    });
    expect(
      parseAdminWithdrawalCommand('mark-paid', {
        expected_version: 3,
        idempotency_key: 'admin-withdrawal-paid-0001',
        admin_remark: '线下转账完成',
      }),
    ).toMatchObject({ ok: false });
  });

  it('binds the request hash to action, target and version', () => {
    const base = {
      withdrawal_id: 'withdrawal-1',
      action: 'approve' as const,
      expected_version: 1,
      admin_remark: '审核通过',
      manual_reference: null,
    };
    expect(buildAdminWithdrawalRequestHash(base)).not.toBe(
      buildAdminWithdrawalRequestHash({ ...base, expected_version: 2 }),
    );
    expect(buildAdminWithdrawalRequestHash(base)).not.toBe(
      buildAdminWithdrawalRequestHash({ ...base, action: 'reject' }),
    );
  });
});
