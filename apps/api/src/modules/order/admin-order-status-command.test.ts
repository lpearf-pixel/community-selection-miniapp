import { describe, expect, it } from 'vitest';
import {
  buildAdminOrderStatusRequestHash,
  parseAdminOrderStatusCommand,
} from './admin-order-status-command.js';

describe('Admin order status command contract', () => {
  it('parses one valid command without normalizing the idempotency key', () => {
    expect(
      parseAdminOrderStatusCommand({
        next_status: 'ready',
        expected_version: 3,
        idempotency_key: 'idem-123456789012',
      }),
    ).toEqual({
      ok: true,
      value: {
        next_status: 'ready',
        expected_version: 3,
        idempotency_key: 'idem-123456789012',
      },
    });
  });

  it('accepts printable ASCII with internal spaces', () => {
    expect(
      parseAdminOrderStatusCommand({
        next_status: 'ready',
        expected_version: 1,
        idempotency_key: 'idem internal key 01',
      }),
    ).toMatchObject({
      ok: true,
      value: { idempotency_key: 'idem internal key 01' },
    });
  });

  it.each([
    null,
    [],
    {},
    { next_status: 'paid', expected_version: 1, idempotency_key: 'idem-123456789012' },
    { next_status: 'ready', expected_version: 0, idempotency_key: 'idem-123456789012' },
    { next_status: 'ready', expected_version: 1.5, idempotency_key: 'idem-123456789012' },
    { next_status: 'ready', expected_version: 1, idempotency_key: 'short' },
    { next_status: 'ready', expected_version: 1, idempotency_key: ' idem-123456789012' },
    { next_status: 'ready', expected_version: 1, idempotency_key: 'idem-123456789012 ' },
    { next_status: 'ready', expected_version: 1, idempotency_key: '幂等键-12345678901234' },
  ])('rejects an invalid command: %j', (input) => {
    expect(parseAdminOrderStatusCommand(input)).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_ORDER_STATUS_COMMAND',
      message: '订单状态命令不合法',
    });
  });

  it('hashes the operation, target, status and expected version canonically', () => {
    const base = {
      order_id: 'order-1',
      next_status: 'ready' as const,
      expected_version: 3,
    };
    const first = buildAdminOrderStatusRequestHash(base);
    const second = buildAdminOrderStatusRequestHash({ ...base });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(
      buildAdminOrderStatusRequestHash({
        ...base,
        expected_version: 4,
      }),
    ).not.toBe(first);
    expect(
      buildAdminOrderStatusRequestHash({
        ...base,
        order_id: 'order-2',
      }),
    ).not.toBe(first);
  });
});
