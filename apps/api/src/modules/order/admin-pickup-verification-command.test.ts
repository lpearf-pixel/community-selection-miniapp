import { describe, expect, it } from 'vitest';
import {
  buildAdminPickupVerificationRequestHash,
  parseAdminPickupVerificationCommand,
} from './admin-pickup-verification-command.js';

describe('Admin pickup verification command contract', () => {
  it('parses one valid command without normalizing accepted values', () => {
    expect(
      parseAdminPickupVerificationCommand({
        expected_version: 4,
        idempotency_key: 'pickup-verify-key01',
        admin_remark: '顾客现场出示取货信息',
      }),
    ).toEqual({
      ok: true,
      value: {
        expected_version: 4,
        idempotency_key: 'pickup-verify-key01',
        admin_remark: '顾客现场出示取货信息',
      },
    });
  });

  it('canonicalizes an absent remark to null', () => {
    expect(
      parseAdminPickupVerificationCommand({
        expected_version: 1,
        idempotency_key: 'pickup-verify-key02',
      }),
    ).toEqual({
      ok: true,
      value: {
        expected_version: 1,
        idempotency_key: 'pickup-verify-key02',
        admin_remark: null,
      },
    });
  });

  it.each([
    null,
    [],
    {},
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03',
      admin_remark: null,
      unknown: true,
    },
    {
      expected_version: 0,
      idempotency_key: 'pickup-verify-key03',
    },
    {
      expected_version: 1.5,
      idempotency_key: 'pickup-verify-key03',
    },
    {
      expected_version: 1,
      idempotency_key: 'short',
    },
    {
      expected_version: 1,
      idempotency_key: ' pickup-verify-key03',
    },
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03 ',
    },
    {
      expected_version: 1,
      idempotency_key: '核销-key-123456789012',
    },
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03',
      admin_remark: ' padded',
    },
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03',
      admin_remark: 'padded ',
    },
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03',
      admin_remark: 'x'.repeat(501),
    },
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03',
      admin_remark: 'line\nfeed',
    },
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03',
      admin_remark: 'tab\tvalue',
    },
    {
      expected_version: 1,
      idempotency_key: 'pickup-verify-key03',
      admin_remark: 'nul\u0000value',
    },
  ])('rejects an invalid command: %j', (input) => {
    expect(parseAdminPickupVerificationCommand(input)).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_PICKUP_VERIFY_COMMAND',
      message: '自提核销命令不合法',
    });
  });

  it('hashes operation, target, version and canonical remark', () => {
    const base = {
      order_id: 'order-1',
      expected_version: 4,
      admin_remark: null,
    };
    const first = buildAdminPickupVerificationRequestHash(base);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(buildAdminPickupVerificationRequestHash({ ...base })).toBe(first);
    expect(
      buildAdminPickupVerificationRequestHash({
        ...base,
        order_id: 'order-2',
      }),
    ).not.toBe(first);
    expect(
      buildAdminPickupVerificationRequestHash({
        ...base,
        expected_version: 5,
      }),
    ).not.toBe(first);
    expect(
      buildAdminPickupVerificationRequestHash({
        ...base,
        admin_remark: '现场核销',
      }),
    ).not.toBe(first);
  });
});
