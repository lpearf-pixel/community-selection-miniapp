import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmRefundSuccess,
  createPendingRefund,
  findRefundByClientKey,
  getRefundRecord,
  setRefundStockRestored,
} from './refund-record-service.js';

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const tx = { refund: { findUnique, create, update } } as any;

const existing = {
  id: 'refund-1',
  order_id: 'order-1',
  out_refund_no: 'RF-1',
  client_refund_id: 'client-1',
  refund_id: null,
  refund_amount_cents: 500,
  product_refund_amount_cents: 400,
  delivery_refund_amount_cents: 100,
  reason: '售后退款',
  status: 'pending',
  stock_restored: false,
  raw_notify: null,
  processed_at: null,
};

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
});

describe('refund record owner', () => {
  it('loads a refund by its owner id', async () => {
    findUnique.mockResolvedValue(existing);
    await expect(getRefundRecord(tx, existing.id)).resolves.toEqual(existing);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: existing.id } });
  });

  it('finds a matching refund by client key before out refund number', async () => {
    findUnique.mockResolvedValue(existing);

    await expect(findRefundByClientKey(tx, {
      order_id: 'order-1',
      client_refund_id: 'client-1',
      out_refund_no: 'RF-1',
      refund_amount_cents: 500,
      product_refund_amount_cents: 400,
      delivery_refund_amount_cents: 100,
    })).resolves.toEqual(existing);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { client_refund_id: 'client-1' },
    });
  });

  it('falls back to the out refund number when no client key exists', async () => {
    findUnique.mockResolvedValue(existing);

    await expect(findRefundByClientKey(tx, {
      order_id: 'order-1',
      out_refund_no: 'RF-1',
      refund_amount_cents: 500,
      product_refund_amount_cents: 400,
      delivery_refund_amount_cents: 100,
    })).resolves.toEqual(existing);

    expect(findUnique).toHaveBeenCalledWith({
      where: { out_refund_no: 'RF-1' },
    });
  });

  it('rejects reuse of a client refund key with different money', async () => {
    findUnique.mockResolvedValue(existing);

    await expect(findRefundByClientKey(tx, {
      order_id: 'order-1',
      client_refund_id: 'client-1',
      out_refund_no: 'RF-1',
      refund_amount_cents: 600,
      product_refund_amount_cents: 500,
      delivery_refund_amount_cents: 100,
    })).rejects.toThrowError('退款幂等键已被使用，且请求参数不一致');
  });

  it('matches a legacy request that omitted the optional split', async () => {
    findUnique.mockResolvedValue(existing);
    await expect(findRefundByClientKey(tx, {
      order_id: 'order-1',
      client_refund_id: 'client-1',
      out_refund_no: 'RF-1',
      refund_amount_cents: 500,
    } as any)).resolves.toEqual(existing);
  });

  it('creates one pending refund with the supplied split', async () => {
    create.mockResolvedValue(existing);

    await expect(createPendingRefund(tx, {
      order_id: 'order-1',
      out_refund_no: 'RF-1',
      client_refund_id: 'client-1',
      refund_amount_cents: 500,
      product_refund_amount_cents: 400,
      delivery_refund_amount_cents: 100,
      reason: '售后退款',
    })).resolves.toEqual(existing);

    expect(create).toHaveBeenCalledWith({
      data: {
        order_id: 'order-1',
        out_refund_no: 'RF-1',
        client_refund_id: 'client-1',
        refund_amount_cents: 500,
        product_refund_amount_cents: 400,
        delivery_refund_amount_cents: 100,
        reason: '售后退款',
        status: 'pending',
      },
    });
  });

  it('confirms a pending refund as the first success', async () => {
    const successful = {
      ...existing,
      status: 'success',
      refund_id: 'wx-refund-1',
      raw_notify: { source: 'wechat' },
      processed_at: new Date('2026-07-26T00:00:00.000Z'),
    };
    findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    update.mockResolvedValue(successful);

    await expect(confirmRefundSuccess(tx, existing.id, {
      refund_id: 'wx-refund-1',
      out_refund_no: 'RF-1',
      raw_notify: { source: 'wechat' },
    })).resolves.toEqual({ refund: successful, first_success: true });

    expect(update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: {
        status: 'success',
        refund_id: 'wx-refund-1',
        processed_at: expect.any(Date),
        raw_notify: { source: 'wechat' },
      },
    });
  });

  it('backfills only a missing provider id on repeated success', async () => {
    const successful = { ...existing, status: 'success' };
    const backfilled = { ...successful, refund_id: 'wx-refund-1' };
    findUnique
      .mockResolvedValueOnce(successful)
      .mockResolvedValueOnce(null);
    update.mockResolvedValue(backfilled);

    await expect(confirmRefundSuccess(tx, existing.id, {
      refund_id: 'wx-refund-1',
      out_refund_no: 'RF-1',
    })).resolves.toEqual({ refund: backfilled, first_success: false });

    expect(update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { refund_id: 'wx-refund-1' },
    });
  });

  it('returns an unchanged repeated success without a write', async () => {
    const successful = {
      ...existing,
      status: 'success',
      refund_id: 'wx-refund-1',
    };
    findUnique.mockResolvedValue(successful);

    await expect(confirmRefundSuccess(tx, existing.id, {
      refund_id: 'wx-refund-1',
      out_refund_no: 'RF-1',
    })).resolves.toEqual({ refund: successful, first_success: false });

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a provider id already owned by another refund', async () => {
    findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, id: 'refund-2' });

    await expect(confirmRefundSuccess(tx, existing.id, {
      refund_id: 'wx-refund-1',
      out_refund_no: 'RF-1',
    })).rejects.toThrowError('微信 refund_id 与已有退款记录不一致');
  });

  it('rejects success for a rejected refund', async () => {
    findUnique.mockResolvedValue({ ...existing, status: 'rejected' });

    await expect(confirmRefundSuccess(tx, existing.id)).rejects.toThrowError(
      '已拒绝退款不可成功',
    );
  });

  it('updates the stock-restored projection inside the Refund owner', async () => {
    const restored = { ...existing, stock_restored: true };
    update.mockResolvedValue(restored);

    await expect(
      setRefundStockRestored(tx, existing.id, true),
    ).resolves.toEqual(restored);
    expect(update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { stock_restored: true },
    });
  });
});
