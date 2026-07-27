import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaWechatReceiptStore,
  processWechatPaymentNotification,
} from './wechat-payment-notification.js';

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
    expect(deps.receipts.complete).toHaveBeenCalledWith(
      'notification-a',
      expect.any(String),
    );
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

describe('WeChat notification receipt claims', () => {
  const input = {
    notificationId: 'notification-a',
    notificationType: 'payment' as const,
    eventType: 'TRANSACTION.SUCCESS',
    resourceIdentifier: 'PAYORDERA001',
    bodySha256: 'a'.repeat(64),
    claimToken: 'claim-new',
  };

  function duplicateClient(existing: {
    id: string;
    body_sha256: string;
    status: string;
    updated_at: Date;
  }) {
    return {
      wechatNotificationReceipt: {
        create: vi.fn(async () => {
          throw { code: 'P2002' };
        }),
        findUniqueOrThrow: vi.fn(async () => existing),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
  }

  it('atomically reclaims a failed receipt instead of acknowledging it', async () => {
    const existing = {
      id: 'receipt-a',
      body_sha256: input.bodySha256,
      status: 'failed',
      updated_at: new Date('2026-07-26T12:00:00.000Z'),
    };
    const client = duplicateClient(existing);
    const store = createPrismaWechatReceiptStore(client as any);

    await expect(store.begin(input)).resolves.toBe('new');
    expect(client.wechatNotificationReceipt.updateMany).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        body_sha256: input.bodySha256,
        status: 'failed',
        updated_at: existing.updated_at,
      },
      data: {
        status: 'processing',
        claim_token: input.claimToken,
        failure_code: null,
        processed_at: null,
      },
    });
  });

  it('only acknowledges an already applied receipt as a replay', async () => {
    const client = duplicateClient({
      id: 'receipt-a',
      body_sha256: input.bodySha256,
      status: 'applied',
      updated_at: new Date(),
    });
    const store = createPrismaWechatReceiptStore(client as any);

    await expect(store.begin(input)).resolves.toBe('replay');
    expect(client.wechatNotificationReceipt.updateMany).not.toHaveBeenCalled();
  });

  it('reports a fresh in-flight receipt as busy', async () => {
    const client = duplicateClient({
      id: 'receipt-a',
      body_sha256: input.bodySha256,
      status: 'processing',
      updated_at: new Date(),
    });
    const store = createPrismaWechatReceiptStore(client as any);

    await expect(store.begin(input)).resolves.toBe('busy');
    expect(client.wechatNotificationReceipt.updateMany).not.toHaveBeenCalled();
  });

  it('atomically reclaims an expired processing lease', async () => {
    const existing = {
      id: 'receipt-a',
      body_sha256: input.bodySha256,
      status: 'processing',
      updated_at: new Date('2020-01-01T00:00:00.000Z'),
    };
    const client = duplicateClient(existing);
    const store = createPrismaWechatReceiptStore(client as any);

    await expect(store.begin(input)).resolves.toBe('new');
    expect(client.wechatNotificationReceipt.updateMany).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        body_sha256: input.bodySha256,
        status: 'processing',
        updated_at: existing.updated_at,
      },
      data: {
        status: 'processing',
        claim_token: input.claimToken,
        failure_code: null,
        processed_at: null,
      },
    });
  });

  it('rejects completion and failure from a superseded claimant', async () => {
    const client = duplicateClient({
      id: 'receipt-a',
      body_sha256: input.bodySha256,
      status: 'processing',
      updated_at: new Date(),
    });
    client.wechatNotificationReceipt.updateMany.mockResolvedValue({
      count: 0,
    });
    const store = createPrismaWechatReceiptStore(client as any);

    await expect(
      store.complete(input.notificationId, 'claim-old'),
    ).rejects.toThrow('WECHAT_NOTIFY_RECEIPT_CLAIM_LOST');
    await expect(
      store.fail(
        input.notificationId,
        'claim-old',
        'WECHAT_PAYMENT_NOTIFICATION_FAILED',
      ),
    ).rejects.toThrow('WECHAT_NOTIFY_RECEIPT_CLAIM_LOST');
    expect(client.wechatNotificationReceipt.updateMany).toHaveBeenCalledWith({
      where: {
        notification_id: input.notificationId,
        status: 'processing',
        claim_token: 'claim-old',
      },
      data: {
        status: 'applied',
        processed_at: expect.any(Date),
        failure_code: null,
      },
    });
  });
});
