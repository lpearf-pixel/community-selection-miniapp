import { describe, expect, it, vi } from 'vitest';
import { createWechatReconciler } from './wechat-reconciler.js';

function dependencies(lock = true) {
  return {
    acquireLock: vi.fn(async () => lock),
    listPendingPayments: vi.fn(async () => [{
      id: 'payment-a',
      order_id: 'order-a',
      out_trade_no: 'PAY-A',
    }]),
    queryTransaction: vi.fn(async () => ({
      trade_state: 'SUCCESS',
      transaction_id: 'wx-pay-a',
      success_time: '2026-07-26T20:00:00+08:00',
    })),
    markOrderPaid: vi.fn(async () => undefined),
    updatePaymentState: vi.fn(async () => undefined),
    listPendingRefunds: vi.fn(async () => [{
      id: 'refund-a',
      out_refund_no: 'RF-A',
    }]),
    queryRefund: vi.fn(async () => ({
      status: 'SUCCESS',
      refund_id: 'wx-refund-a',
      success_time: '2026-07-26T20:01:00+08:00',
    })),
    markRefundSuccess: vi.fn(async () => undefined),
    updateRefundState: vi.fn(async () => undefined),
    upsertAlert: vi.fn(async () => undefined),
  };
}

describe('WeChat state reconciler', () => {
  it('lets only the advisory-lock holder scan', async () => {
    const deps = dependencies(false);
    const reconciler = createWechatReconciler(deps);

    await expect(
      reconciler.reconcile(new Date('2026-07-26T12:00:00.000Z')),
    ).resolves.toEqual({ skipped: true, payments: 0, refunds: 0 });

    expect(deps.listPendingPayments).not.toHaveBeenCalled();
    expect(deps.listPendingRefunds).not.toHaveBeenCalled();
  });

  it('converges provider SUCCESS through the existing projection owners', async () => {
    const deps = dependencies();
    const reconciler = createWechatReconciler(deps);

    await expect(
      reconciler.reconcile(new Date('2026-07-26T12:05:00.000Z')),
    ).resolves.toEqual({ skipped: false, payments: 1, refunds: 1 });

    expect(deps.markOrderPaid).toHaveBeenCalledWith('order-a', {
      payment_id: 'payment-a',
      out_trade_no: 'PAY-A',
      transaction_id: 'wx-pay-a',
      provider_success_at: new Date('2026-07-26T12:00:00.000Z'),
    });
    expect(deps.markRefundSuccess).toHaveBeenCalledWith('refund-a', {
      refund_id: 'wx-refund-a',
      out_refund_no: 'RF-A',
      provider_status: 'SUCCESS',
      provider_success_at: new Date('2026-07-26T12:01:00.000Z'),
    });
  });
});
