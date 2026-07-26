import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmPaymentRecordPaid,
  findPaymentForOrder,
} from './payment-record-service.js';

const findUnique = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();
const tx = {
  payment: {
    findUnique,
    findFirst,
    update,
  },
} as any;

const payment = {
  id: 'payment-1',
  order_id: 'order-1',
  out_trade_no: 'trade-1',
  transaction_id: 'wechat-existing',
  prepay_id: null,
  amount_cents: 1200,
  trade_state: 'created',
  raw_notify: null,
  created_at: new Date('2026-07-25T00:00:00.000Z'),
  updated_at: new Date('2026-07-25T00:00:00.000Z'),
};

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
  update.mockReset();
});

describe('payment record owner', () => {
  it('finds the explicitly identified payment before any fallback', async () => {
    findUnique.mockResolvedValue(payment);

    await expect(
      findPaymentForOrder(tx, 'order-1', {
        payment_id: 'payment-1',
        out_trade_no: 'trade-ignored',
      }),
    ).resolves.toEqual(payment);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'payment-1' } });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('uses out trade number when payment id is absent', async () => {
    findUnique.mockResolvedValue(payment);

    await expect(
      findPaymentForOrder(tx, 'order-1', { out_trade_no: 'trade-1' }),
    ).resolves.toEqual(payment);

    expect(findUnique).toHaveBeenCalledWith({
      where: { out_trade_no: 'trade-1' },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the latest payment belonging to the order', async () => {
    findFirst.mockResolvedValue(payment);

    await expect(
      findPaymentForOrder(tx, 'order-1', {}),
    ).resolves.toEqual(payment);

    expect(findFirst).toHaveBeenCalledWith({
      where: { order_id: 'order-1' },
      orderBy: { created_at: 'desc' },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('preserves an absent payment without attempting a write', async () => {
    await expect(
      confirmPaymentRecordPaid(tx, null, {
        transaction_id: 'wechat-new',
      }),
    ).resolves.toBeNull();

    expect(update).not.toHaveBeenCalled();
  });

  it('keeps an existing transaction id and writes an explicitly supplied notify', async () => {
    const paid = {
      ...payment,
      trade_state: 'paid',
      raw_notify: { event: 'paid' },
    };
    update.mockResolvedValue(paid);

    await expect(
      confirmPaymentRecordPaid(tx, payment as any, {
        transaction_id: 'wechat-new-must-not-replace',
        raw_notify: { event: 'paid' },
      }),
    ).resolves.toEqual(paid);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: {
        trade_state: 'paid',
        transaction_id: 'wechat-existing',
        raw_notify: { event: 'paid' },
      },
    });
  });

  it('omits raw notify when the caller did not supply it', async () => {
    const withoutTransaction = {
      ...payment,
      transaction_id: null,
    };
    update.mockResolvedValue({
      ...withoutTransaction,
      trade_state: 'paid',
      transaction_id: 'wechat-new',
    });

    await confirmPaymentRecordPaid(tx, withoutTransaction as any, {
      transaction_id: 'wechat-new',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: {
        trade_state: 'paid',
        transaction_id: 'wechat-new',
      },
    });
  });
});
