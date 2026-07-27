import { describe, expect, it, vi } from 'vitest';
import { createWechatPaymentCommand } from './wechat-payment-command.js';

const prepared = {
  order: {
    id: 'order-a',
    order_no: 'ORDERA',
    pay_amount_cents: 1,
    openid: 'openid-from-database',
    description: '有机蔬菜订单 ORDERA',
  },
  payment: {
    id: 'payment-a',
    out_trade_no: 'PAYORDERA001',
    prepay_id: null,
    prepay_expires_at: null,
  },
};

describe('WeChat JSAPI payment command', () => {
  it('uses server-owned order amount and user openid', async () => {
    const prepare = vi.fn(async () => prepared);
    const savePrepay = vi.fn(async () => undefined);
    const createJsapiTransaction = vi.fn(async () => ({
      prepayId: 'prepay-a',
    }));
    const command = createWechatPaymentCommand({
      store: { prepare, savePrepay },
      payClient: { createJsapiTransaction },
      signJsapi: vi.fn(() => ({
        timeStamp: '1700000000',
        nonceStr: 'nonce-a',
        package: 'prepay_id=prepay-a',
        signType: 'RSA' as const,
        paySign: 'signature-a',
      })),
      now: () => new Date('2026-07-27T00:00:00.000Z'),
    });

    const result = await command.initialize({
      userId: 'user-a',
      orderId: 'order-a',
      clientIp: '203.0.113.10',
    });

    expect(prepare).toHaveBeenCalledWith(
      'user-a',
      'order-a',
      new Date('2026-07-27T00:00:00.000Z'),
    );
    expect(createJsapiTransaction).toHaveBeenCalledWith({
      description: '有机蔬菜订单 ORDERA',
      outTradeNo: 'PAYORDERA001',
      amountCents: 1,
      openid: 'openid-from-database',
      expiresAt: new Date('2026-07-27T00:15:00.000Z'),
      attach: 'order-a',
      clientIp: '203.0.113.10',
    });
    expect(savePrepay).toHaveBeenCalledWith(
      'payment-a',
      'prepay-a',
      new Date('2026-07-27T00:15:00.000Z'),
    );
    expect(result).toMatchObject({
      order_id: 'order-a',
      out_trade_no: 'PAYORDERA001',
      amount_cents: 1,
      wx_request_payment: { package: 'prepay_id=prepay-a' },
    });
  });

  it('reuses an unexpired prepay id without another provider request', async () => {
    const createJsapiTransaction = vi.fn();
    const command = createWechatPaymentCommand({
      store: {
        prepare: vi.fn(async () => ({
          ...prepared,
          payment: {
            ...prepared.payment,
            prepay_id: 'prepay-existing',
            prepay_expires_at: new Date('2026-07-27T00:10:00.000Z'),
          },
        })),
        savePrepay: vi.fn(),
      },
      payClient: { createJsapiTransaction },
      signJsapi: vi.fn(() => ({
        timeStamp: '1',
        nonceStr: 'n',
        package: 'prepay_id=prepay-existing',
        signType: 'RSA' as const,
        paySign: 's',
      })),
      now: () => new Date('2026-07-27T00:00:00.000Z'),
    });

    await expect(
      command.initialize({ userId: 'user-a', orderId: 'order-a' }),
    ).resolves.toMatchObject({
      wx_request_payment: { package: 'prepay_id=prepay-existing' },
    });
    expect(createJsapiTransaction).not.toHaveBeenCalled();
  });
});
