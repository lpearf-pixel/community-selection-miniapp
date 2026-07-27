import { describe, expect, it, vi } from 'vitest';
import { processWechatPaymentNotification } from './wechat-payment-notification.js';

const verified = {
  notificationId: 'notification-a',
  eventType: 'TRANSACTION.SUCCESS',
  bodySha256: 'a'.repeat(64),
  resource: {
    appid: 'wx-app',
    mchid: 'merchant-a',
    trade_state: 'SUCCESS',
    trade_type: 'JSAPI',
    out_trade_no: 'PAYORDERA001',
    transaction_id: 'transaction-a',
    success_time: '2026-07-27T00:00:00+08:00',
    payer: { openid: 'openid-a' },
    amount: {
      total: 1,
      payer_total: 1,
      currency: 'CNY',
      payer_currency: 'CNY',
    },
  },
};

const payment = {
  id: 'payment-a',
  order_id: 'order-a',
  out_trade_no: 'PAYORDERA001',
  amount_cents: 1,
  order: {
    user: { openid: 'openid-a' },
  },
};

function dependencies(beginResult: 'new' | 'replay' | 'collision' = 'new') {
  return {
    receipts: {
      begin: vi.fn(async () => beginResult),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    },
    payments: {
      findByOutTradeNo: vi.fn(async () => payment),
    },
    markOrderPaid: vi.fn(async () => undefined),
  };
}

describe('verified WeChat payment notification', () => {
  it('validates provider identity and converges through payment success owner', async () => {
    const deps = dependencies();
    await expect(
      processWechatPaymentNotification({
        verified,
        expectedAppId: 'wx-app',
        expectedMerchantId: 'merchant-a',
        ...deps,
      }),
    ).resolves.toEqual({ replay: false });

    expect(deps.markOrderPaid).toHaveBeenCalledWith('order-a', {
      payment_id: 'payment-a',
      out_trade_no: 'PAYORDERA001',
      transaction_id: 'transaction-a',
      provider_success_at: new Date('2026-07-26T16:00:00.000Z'),
    });
    expect(deps.receipts.complete).toHaveBeenCalledWith('notification-a');
  });

  it('acknowledges identical replay without projecting twice', async () => {
    const deps = dependencies('replay');
    await expect(
      processWechatPaymentNotification({
        verified,
        expectedAppId: 'wx-app',
        expectedMerchantId: 'merchant-a',
        ...deps,
      }),
    ).resolves.toEqual({ replay: true });
    expect(deps.payments.findByOutTradeNo).not.toHaveBeenCalled();
    expect(deps.markOrderPaid).not.toHaveBeenCalled();
  });

  it('fails closed on receipt collision, amount, merchant, or openid mismatch', async () => {
    const collision = dependencies('collision');
    await expect(
      processWechatPaymentNotification({
        verified,
        expectedAppId: 'wx-app',
        expectedMerchantId: 'merchant-a',
        ...collision,
      }),
    ).rejects.toThrow(/WECHAT_NOTIFY_ID_COLLISION/);

    for (const resource of [
      { ...verified.resource, mchid: 'other-merchant' },
      {
        ...verified.resource,
        amount: { ...verified.resource.amount, total: 2 },
      },
      {
        ...verified.resource,
        payer: { openid: 'other-openid' },
      },
    ]) {
      const deps = dependencies();
      await expect(
        processWechatPaymentNotification({
          verified: { ...verified, resource },
          expectedAppId: 'wx-app',
          expectedMerchantId: 'merchant-a',
          ...deps,
        }),
      ).rejects.toThrow(/WECHAT_PAYMENT_/);
      expect(deps.markOrderPaid).not.toHaveBeenCalled();
      expect(deps.receipts.fail).toHaveBeenCalled();
    }
  });
});
