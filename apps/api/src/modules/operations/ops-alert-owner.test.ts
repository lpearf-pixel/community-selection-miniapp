import { describe, expect, it, vi } from 'vitest';
import { upsertOpsAlert } from './ops-alert-owner.js';

describe('operations alert owner', () => {
  it('upserts by a stable dedupe key instead of creating duplicates', async () => {
    const upsert = vi.fn(async () => ({ id: 'alert-a' }));
    const client = { opsAlertLog: { upsert } } as any;

    await upsertOpsAlert(client, 'wechat-payment:payment-a:PAYERROR', {
      alert_type: 'wechat_payment_reconcile',
      alert_level: 'error',
      payment_id: 'payment-a',
      title: '微信支付对账异常',
      message: '支付状态为 PAYERROR',
      payload: { provider_state: 'PAYERROR' },
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { dedupe_key: 'wechat-payment:payment-a:PAYERROR' },
      create: expect.objectContaining({
        dedupe_key: 'wechat-payment:payment-a:PAYERROR',
        status: 'open',
      }),
      update: expect.objectContaining({
        alert_level: 'error',
        status: 'open',
      }),
    });
  });
});
