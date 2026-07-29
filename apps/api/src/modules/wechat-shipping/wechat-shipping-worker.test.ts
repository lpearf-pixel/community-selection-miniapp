import { describe, expect, it, vi } from 'vitest';
import {
  retryDelayMs,
  runWechatShippingWorker,
  type WechatShippingWorkItem,
} from './wechat-shipping-worker.js';

const now = new Date('2026-07-29T12:00:00.000Z');

function item(
  overrides: Partial<WechatShippingWorkItem> = {},
): WechatShippingWorkItem {
  return {
    id: 'intent-1',
    orderId: 'order-1',
    logisticsType: 2,
    attemptCount: 1,
    transactionId: '420001',
    openid: 'openid-one',
    itemDescription: '有机蔬菜',
    ...overrides,
  };
}

function ports(
  items: WechatShippingWorkItem[],
  upload = vi.fn().mockResolvedValue(undefined),
) {
  return {
    claimDue: vi.fn().mockResolvedValue(items),
    upload,
    markSucceeded: vi.fn().mockResolvedValue(undefined),
    markRetryable: vi.fn().mockResolvedValue(undefined),
    markManualRequired: vi.fn().mockResolvedValue(undefined),
  };
}

describe('WeChat shipping worker', () => {
  it('claims at most 20 and makes provider success terminal', async () => {
    const subject = ports([item()]);

    await expect(runWechatShippingWorker(subject, now)).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      retryable: 0,
      manualRequired: 0,
    });
    expect(subject.claimDue).toHaveBeenCalledWith(now, 20);
    expect(subject.markSucceeded).toHaveBeenCalledWith('intent-1', now);
    expect(subject.markRetryable).not.toHaveBeenCalled();
    expect(subject.markManualRequired).not.toHaveBeenCalled();
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 30],
    [9, 30],
  ])('backs off attempt %s by %s minutes', (attempt, minutes) => {
    expect(retryDelayMs(attempt)).toBe(minutes * 60_000);
  });

  it('records retryable failures with the next due time', async () => {
    const subject = ports(
      [item({ attemptCount: 3 })],
      vi.fn().mockRejectedValue(new Error('WECHAT_SHIPPING_HTTP_503')),
    );

    await expect(runWechatShippingWorker(subject, now)).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      retryable: 1,
      manualRequired: 0,
    });
    expect(subject.markRetryable).toHaveBeenCalledWith('intent-1', {
      code: 'WECHAT_SHIPPING_HTTP_503',
      nextRetryAt: new Date('2026-07-29T12:04:00.000Z'),
    });
  });

  it.each([
    ['transactionId', 'WECHAT_SHIPPING_PAYMENT_ID_MISSING'],
    ['openid', 'WECHAT_SHIPPING_OPENID_MISSING'],
    ['itemDescription', 'WECHAT_SHIPPING_ITEM_DESCRIPTION_MISSING'],
  ] as const)(
    'requires %s and never calls the provider when it is absent',
    async (field, code) => {
      const subject = ports([item({ [field]: '' })]);

      await runWechatShippingWorker(subject, now);

      expect(subject.upload).not.toHaveBeenCalled();
      expect(subject.markManualRequired).toHaveBeenCalledWith('intent-1', {
        code,
      });
    },
  );

  it('makes deterministic provider failures manual', async () => {
    const subject = ports(
      [item()],
      vi.fn().mockRejectedValue(new Error('WECHAT_SHIPPING_40013')),
    );

    await runWechatShippingWorker(subject, now);

    expect(subject.markManualRequired).toHaveBeenCalledWith('intent-1', {
      code: 'WECHAT_SHIPPING_40013',
    });
  });
});
