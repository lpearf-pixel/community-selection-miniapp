import { describe, expect, it, vi } from 'vitest';
import { processWechatRefundNotification } from './wechat-refund-notification.js';

const verified = {
  notificationId: 'notify-refund-a',
  eventType: 'REFUND.SUCCESS',
  bodySha256: 'abc123',
  resource: {
    mchid: 'merchant-a',
    out_refund_no: 'RF-A',
    refund_id: 'wx-refund-a',
    refund_status: 'SUCCESS',
    amount: {
      refund: 500,
      total: 1200,
      payer_refund: 500,
      payer_total: 1200,
    },
    success_time: '2026-07-26T20:00:00+08:00',
  },
};

function dependencies() {
  return {
    receipts: {
      begin: vi.fn(async (): Promise<'new' | 'replay' | 'collision'> => 'new'),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    },
    refunds: {
      findByOutRefundNo: vi.fn(
        async (): Promise<{
          id: string;
          out_refund_no: string;
          refund_amount_cents: number;
          order: { pay_amount_cents: number };
        } | null> => ({
          id: 'refund-a',
          out_refund_no: 'RF-A',
          refund_amount_cents: 500,
          order: { pay_amount_cents: 1200 },
        }),
      ),
    },
    markRefundSuccess: vi.fn(async () => ({ id: 'refund-a' })),
  };
}

describe('WeChat refund notification', () => {
  it('projects only a verified matching SUCCESS notification', async () => {
    const deps = dependencies();

    await expect(
      processWechatRefundNotification({
        verified,
        expectedMerchantId: 'merchant-a',
        ...deps,
      }),
    ).resolves.toEqual({ replay: false });

    expect(deps.markRefundSuccess).toHaveBeenCalledWith('refund-a', {
      refund_id: 'wx-refund-a',
      out_refund_no: 'RF-A',
      provider_status: 'SUCCESS',
      provider_success_at: new Date('2026-07-26T12:00:00.000Z'),
    });
    expect(deps.receipts.complete).toHaveBeenCalledWith(
      'notify-refund-a',
      expect.any(String),
    );
  });

  it('rejects failed or mismatched amounts without projecting', async () => {
    const failed = dependencies();
    await expect(
      processWechatRefundNotification({
        verified: {
          ...verified,
          eventType: 'REFUND.CLOSED',
          resource: { ...verified.resource, refund_status: 'CLOSED' },
        },
        expectedMerchantId: 'merchant-a',
        ...failed,
      }),
    ).rejects.toThrow('WECHAT_REFUND_EVENT_INVALID');
    expect(failed.markRefundSuccess).not.toHaveBeenCalled();

    const mismatched = dependencies();
    await expect(
      processWechatRefundNotification({
        verified: {
          ...verified,
          resource: {
            ...verified.resource,
            amount: { ...verified.resource.amount, refund: 499 },
          },
        },
        expectedMerchantId: 'merchant-a',
        ...mismatched,
      }),
    ).rejects.toThrow('WECHAT_REFUND_AMOUNT_INVALID');
    expect(mismatched.markRefundSuccess).not.toHaveBeenCalled();
  });

  it('rejects an unknown refund without projecting success', async () => {
    const deps = dependencies();
    deps.refunds.findByOutRefundNo.mockResolvedValue(null);

    await expect(
      processWechatRefundNotification({
        verified,
        expectedMerchantId: 'merchant-a',
        ...deps,
      }),
    ).rejects.toThrow('WECHAT_REFUND_NOT_FOUND');

    expect(deps.markRefundSuccess).not.toHaveBeenCalled();
    expect(deps.receipts.fail).toHaveBeenCalledWith(
      'notify-refund-a',
      expect.any(String),
      'WECHAT_REFUND_NOT_FOUND',
    );
  });

  it('treats duplicate callback/query convergence as one projection', async () => {
    const deps = dependencies();
    deps.receipts.begin.mockResolvedValueOnce('new').mockResolvedValueOnce('replay');

    await processWechatRefundNotification({
      verified,
      expectedMerchantId: 'merchant-a',
      ...deps,
    });
    await expect(
      processWechatRefundNotification({
        verified,
        expectedMerchantId: 'merchant-a',
        ...deps,
      }),
    ).resolves.toEqual({ replay: true });

    expect(deps.markRefundSuccess).toHaveBeenCalledTimes(1);
  });
});
