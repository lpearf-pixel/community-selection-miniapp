import { describe, expect, it } from 'vitest';
import {
  buildAdminRefundRequestHash,
  parseAdminRefundCommand,
} from './admin-refund-command.js';

describe('Admin refund command contract', () => {
  it('parses one valid command and trims the operator remark', () => {
    expect(
      parseAdminRefundCommand({
        expected_version: 7,
        idempotency_key: 'admin-refund-12345678',
        admin_remark: '  审核通过，执行退款  ',
      }),
    ).toEqual({
      ok: true,
      value: {
        expected_version: 7,
        idempotency_key: 'admin-refund-12345678',
        admin_remark: '审核通过，执行退款',
      },
    });
  });

  it.each([
    null,
    [],
    {},
    { expected_version: 0, idempotency_key: 'admin-refund-12345678', admin_remark: '退款' },
    { expected_version: 1.5, idempotency_key: 'admin-refund-12345678', admin_remark: '退款' },
    { expected_version: 1, idempotency_key: 'short', admin_remark: '退款' },
    { expected_version: 1, idempotency_key: 'admin-refund-12345678 ', admin_remark: '退款' },
    { expected_version: 1, idempotency_key: 'admin-refund-12345678', admin_remark: '' },
    { expected_version: 1, idempotency_key: 'admin-refund-12345678', admin_remark: '   ' },
    { expected_version: 1, idempotency_key: 'admin-refund-12345678', admin_remark: 'x'.repeat(501) },
    { expected_version: 1, idempotency_key: 'admin-refund-12345678', admin_remark: 'line\nfeed' },
    {
      expected_version: 1,
      idempotency_key: 'admin-refund-12345678',
      admin_remark: '退款',
      refund_amount_cents: 100,
    },
    {
      expected_version: 1,
      idempotency_key: 'admin-refund-12345678',
      admin_remark: '退款',
      product_refund_amount_cents: 100,
    },
    {
      expected_version: 1,
      idempotency_key: 'admin-refund-12345678',
      admin_remark: '退款',
      delivery_refund_amount_cents: 100,
    },
  ])('rejects an invalid or client-priced command: %j', (input) => {
    expect(parseAdminRefundCommand(input)).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_REFUND_COMMAND',
      message: '退款执行命令不合法',
    });
  });

  it('hashes the target, version, remark and server-approved split', () => {
    const base = {
      after_sale_case_id: 'case-1',
      order_id: 'order-1',
      expected_version: 7,
      admin_remark: '审核通过',
      approved_refund_cents: 3330,
      approved_product_refund_cents: 3000,
      approved_delivery_refund_cents: 330,
    };
    const first = buildAdminRefundRequestHash(base);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(buildAdminRefundRequestHash({ ...base })).toBe(first);
    expect(buildAdminRefundRequestHash({ ...base, after_sale_case_id: 'case-2' })).not.toBe(first);
    expect(buildAdminRefundRequestHash({ ...base, order_id: 'order-2' })).not.toBe(first);
    expect(buildAdminRefundRequestHash({ ...base, expected_version: 8 })).not.toBe(first);
    expect(buildAdminRefundRequestHash({ ...base, admin_remark: '再次执行' })).not.toBe(first);
    expect(buildAdminRefundRequestHash({ ...base, approved_refund_cents: 3000 })).not.toBe(first);
    expect(buildAdminRefundRequestHash({ ...base, approved_product_refund_cents: 2670 })).not.toBe(first);
    expect(buildAdminRefundRequestHash({ ...base, approved_delivery_refund_cents: 0 })).not.toBe(first);
  });
});
