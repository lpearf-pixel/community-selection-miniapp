import { describe, expect, it, vi } from 'vitest';
import { createWechatRefundCommand } from './wechat-refund-command.js';

const intent = {
  refund_id: 'refund-a',
  order_id: 'order-a',
  out_trade_no: 'PAY-A',
  out_refund_no: 'RF-A',
  refund_amount_cents: 500,
  total_amount_cents: 1200,
  reason: '拼团失败',
  provider_status: null,
};

describe('WeChat refund command', () => {
  it('replays a stable client refund id without submitting twice', async () => {
    const createIntent = vi.fn()
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce({ ...intent, provider_status: 'PROCESSING' });
    const applyRefund = vi.fn(async () => ({
      refund_id: 'wx-refund-a',
      status: 'PROCESSING',
    }));
    const saveProviderResult = vi.fn(async () => undefined);
    const command = createWechatRefundCommand({
      createIntent,
      applyRefund,
      saveProviderResult,
    });
    const input = {
      order_id: 'order-a',
      client_refund_id: 'group-failed:group-a:order-a',
      refund_amount_cents: 500,
      reason: '拼团失败',
    };

    await command.submit(input);
    await command.submit(input);

    expect(createIntent).toHaveBeenCalledTimes(2);
    expect(applyRefund).toHaveBeenCalledTimes(1);
    expect(saveProviderResult).toHaveBeenCalledWith('refund-a', {
      refund_id: 'wx-refund-a',
      provider_status: 'PROCESSING',
      last_provider_error_code: null,
    });
  });

  it('keeps the single pending intent queryable after provider uncertainty', async () => {
    const createIntent = vi.fn(async () => intent);
    const applyRefund = vi.fn(async () => {
      throw new Error('NETWORK_TIMEOUT');
    });
    const saveProviderResult = vi.fn(async () => undefined);
    const command = createWechatRefundCommand({
      createIntent,
      applyRefund,
      saveProviderResult,
    });

    await expect(
      command.submit({
        order_id: 'order-a',
        client_refund_id: 'client-a',
        refund_amount_cents: 500,
        reason: '售后退款',
      }),
    ).rejects.toThrow('NETWORK_TIMEOUT');

    expect(createIntent).toHaveBeenCalledTimes(1);
    expect(saveProviderResult).toHaveBeenCalledWith('refund-a', {
      provider_status: null,
      last_provider_error_code: 'NETWORK_TIMEOUT',
    });
  });
});
