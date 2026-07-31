import { describe, expect, it, vi } from 'vitest';
import { buildDeliveryStatusCommandInput } from './delivery-command';

const row = {
  order_id: 'order-1',
  version: 3,
  delivery_status: 'pending_dispatch' as const,
  allowed_next_statuses: ['delivering', 'exception'] as const,
};

describe('L53-B delivery workbench command input', () => {
  it('uses the current version and a generated idempotency key', () => {
    const keyFactory = vi.fn(() => 'delivery-command-0001');

    expect(
      buildDeliveryStatusCommandInput(
        row,
        'delivering',
        '门店开始配送',
        keyFactory,
      ),
    ).toEqual({
      delivery_status: 'delivering',
      expected_version: 3,
      idempotency_key: 'delivery-command-0001',
      remark: '门店开始配送',
    });
    expect(keyFactory).toHaveBeenCalledOnce();
  });

  it('rejects a status not allowed by the current server response', () => {
    expect(() =>
      buildDeliveryStatusCommandInput(
        row,
        'delivered',
        undefined,
        () => 'delivery-command-0002',
      ),
    ).toThrow(/当前配送状态不可变更为/);
  });
});
