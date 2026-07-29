import { describe, expect, it } from 'vitest';
import {
  buildAdminDeliveryStatusRequestHash,
  parseAdminDeliveryStatusCommand,
} from './admin-delivery-status-command.js';

const valid = {
  delivery_status: 'delivering',
  expected_version: 3,
  idempotency_key: 'delivery-command-0001',
  remark: '门店开始配送',
};

describe('L53-B admin delivery status command', () => {
  it('normalizes an allowed command', () => {
    expect(parseAdminDeliveryStatusCommand(valid)).toEqual({
      ok: true,
      value: valid,
    });
  });

  it.each([
    null,
    [],
    {},
    { ...valid, delivery_status: 'assigned' },
    { ...valid, delivery_status: 'delivery_failed' },
    { ...valid, expected_version: 0 },
    { ...valid, expected_version: 1.5 },
    { ...valid, idempotency_key: 'short' },
    { ...valid, idempotency_key: ' delivery-command-0001' },
    { ...valid, extra: true },
    { ...valid, remark: 123 },
    { ...valid, remark: 'x'.repeat(501) },
  ])('rejects malformed command %#', (input) => {
    expect(parseAdminDeliveryStatusCommand(input)).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_DELIVERY_STATUS_COMMAND',
      message: '配送状态命令不合法',
    });
  });

  it('requires a trimmed exception reason', () => {
    for (const remark of [undefined, '', '   ']) {
      expect(
        parseAdminDeliveryStatusCommand({
          ...valid,
          delivery_status: 'exception',
          remark,
        }),
      ).toEqual({
        ok: false,
        code: 'INVALID_ADMIN_DELIVERY_STATUS_COMMAND',
        message: '配送异常原因必填',
      });
    }
  });

  it('hashes every business input but not the idempotency key', () => {
    const first = buildAdminDeliveryStatusRequestHash({
      order_id: 'order-1',
      delivery_status: 'exception',
      expected_version: 3,
      remark: '联系不上收货人',
    });
    const same = buildAdminDeliveryStatusRequestHash({
      order_id: 'order-1',
      delivery_status: 'exception',
      expected_version: 3,
      remark: '联系不上收货人',
    });
    const differentRemark = buildAdminDeliveryStatusRequestHash({
      order_id: 'order-1',
      delivery_status: 'exception',
      expected_version: 3,
      remark: '地址错误',
    });

    expect(first).toBe(same);
    expect(first).not.toBe(differentRemark);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
