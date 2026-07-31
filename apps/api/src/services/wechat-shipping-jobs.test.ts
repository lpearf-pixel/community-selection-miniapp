import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startWechatShippingScheduler,
  toWechatShippingWorkItem,
} from './wechat-shipping-jobs.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('WeChat shipping job orchestration', () => {
  it('maps the claimed database record without inventing identifiers', () => {
    expect(
      toWechatShippingWorkItem({
        id: 'intent-1',
        order_id: 'order-1',
        logistics_type: 2,
        attempt_count: 3,
        order: {
          user: { openid: 'openid-one' },
          product: { name: '有机蔬菜' },
          group_buy: null,
          payments: [{ transaction_id: '420001' }],
        },
      }),
    ).toEqual({
      id: 'intent-1',
      orderId: 'order-1',
      logisticsType: 2,
      attemptCount: 3,
      transactionId: '420001',
      openid: 'openid-one',
      itemDescription: '有机蔬菜',
    });

    expect(
      toWechatShippingWorkItem({
        id: 'intent-2',
        order_id: 'order-2',
        logistics_type: 4,
        attempt_count: 1,
        order: {
          user: { openid: 'openid-two' },
          product: null,
          group_buy: null,
          payments: [],
        },
      }),
    ).toMatchObject({
      transactionId: '',
      itemDescription: '',
    });
  });

  it('does not start in mock mode', () => {
    const run = vi.fn();
    expect(
      startWechatShippingScheduler({
        env: {
          WECHAT_PAY_MODE: 'mock',
          MOCK_WECHAT_PAY: 'true',
        },
        run,
      }),
    ).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs immediately, every minute, and prevents overlap', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const timer = startWechatShippingScheduler({
      env: {
        WECHAT_PAY_MODE: 'wechat',
        MOCK_WECHAT_PAY: 'false',
      },
      run,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    if (timer) clearInterval(timer);
  });
});
