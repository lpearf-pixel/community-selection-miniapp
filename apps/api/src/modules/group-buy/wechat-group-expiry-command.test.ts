import { describe, expect, it, vi } from 'vitest';
import { createWechatGroupExpiryCommand } from './wechat-group-expiry-command.js';

describe('WeChat group expiry command', () => {
  it('queries uncertain payment before closing and deciding group failure', async () => {
    const events: string[] = [];
    const submitRefund = vi.fn(async () => undefined);
    const command = createWechatGroupExpiryCommand({
      acquireLock: vi.fn(async () => true),
      listDueGroups: vi.fn(async () => [{
        id: 'group-a',
        min_quantity: 2,
        orders: [{
          id: 'order-a',
          quantity: 1,
          pay_status: 'unpaid',
          order_status: 'unpaid',
          pay_amount_cents: 1200,
          payments: [{ id: 'payment-a', out_trade_no: 'PAY-A' }],
        }],
      }]),
      queryTransaction: vi.fn(async () => {
        events.push('query');
        return { trade_state: 'SUCCESS' };
      }),
      convergePayment: vi.fn(async () => {
        events.push('converge');
      }),
      refreshGroupProgress: vi.fn(async () => ({
        paid_quantity: 1,
        paid_orders: [{
          id: 'order-a',
          pay_amount_cents: 1200,
        }],
      })),
      closeUnpaidOrders: vi.fn(async () => {
        events.push('close');
      }),
      markGroupSuccess: vi.fn(async () => undefined),
      markGroupFailed: vi.fn(async () => {
        events.push('fail');
      }),
      submitRefund,
      upsertAlert: vi.fn(async () => undefined),
    });

    await command.expire(new Date('2026-07-26T12:00:00.000Z'));

    expect(events).toEqual(['query', 'converge', 'close', 'fail']);
    expect(submitRefund).toHaveBeenCalledWith({
      order_id: 'order-a',
      client_refund_id: 'group-failed:group-a:order-a',
      refund_amount_cents: 1200,
      reason: '拼团到期未成团',
    });
  });

  it('does nothing when another worker owns the advisory lock', async () => {
    const listDueGroups = vi.fn();
    const command = createWechatGroupExpiryCommand({
      acquireLock: vi.fn(async () => false),
      listDueGroups,
    } as any);

    await expect(command.expire(new Date())).resolves.toEqual({
      skipped: true,
      groups: 0,
    });
    expect(listDueGroups).not.toHaveBeenCalled();
  });
});
