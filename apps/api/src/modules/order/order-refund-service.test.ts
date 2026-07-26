import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RefundOrderVersionConflictError,
  lockRefundableOrder,
  projectRefundSuccess,
  recordRefundOrderEffects,
} from './order-refund-service.js';

const calls: string[] = [];
const queryRaw = vi.fn(async () => {
  calls.push('lock');
  return [{ id: 'order-1' }];
});
const findUnique = vi.fn(async () => {
  calls.push('read');
  return order;
}) as any;
const update = vi.fn();
const updateMany = vi.fn();
const createBusinessEvent = vi.fn();
const createTimeline = vi.fn();
const tx = {
  $queryRaw: queryRaw,
  order: { findUnique, update, updateMany },
  businessEventLog: { create: createBusinessEvent },
  orderTimelineLog: { create: createTimeline },
} as any;

const order: any = {
  id: 'order-1',
  order_no: 'ORDER-1',
  client_request_id: 'request-1',
  version: 4,
  user_id: 'user-1',
  group_buy_id: null,
  product_id: 'product-1',
  leader_user_id: null,
  total_amount_cents: 1000,
  product_amount_cents: 800,
  delivery_fee_cents: 200,
  pay_amount_cents: 1000,
  quantity: 1,
  refund_amount_cents: 300,
  product_refund_amount_cents: 300,
  delivery_refund_amount_cents: 0,
  credit_amount_cents: 0,
  credit_source_type: null,
  credit_source_id: null,
  pay_status: 'paid',
  order_status: 'paid',
  refund_status: 'success',
  pickup_type: 'store',
  pickup_store_id: 'store-1',
  community_id: 'community-1',
  receiver_name: '测试用户',
  receiver_phone: '13800000000',
  receiver_address: null,
  delivery_time_window_code: null,
  delivery_time_window_text: null,
  created_at: new Date('2026-07-26T00:00:00.000Z'),
  paid_at: new Date('2026-07-26T00:01:00.000Z'),
  completed_at: null,
  updated_at: new Date('2026-07-26T00:02:00.000Z'),
};

const refund = {
  id: 'refund-2',
  order_id: order.id,
  out_refund_no: 'RF-2',
  client_refund_id: 'client-2',
  refund_id: null,
  refund_amount_cents: 400,
  product_refund_amount_cents: 300,
  delivery_refund_amount_cents: 100,
  reason: '部分退款',
  status: 'success',
  stock_restored: false,
  raw_notify: null,
  processed_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(() => {
  calls.length = 0;
  queryRaw.mockClear();
  findUnique.mockClear();
  update.mockReset();
  updateMany.mockReset();
  createBusinessEvent.mockReset();
  createTimeline.mockReset();
});

describe('order refund owner', () => {
  it('locks the order row before reading the current projection', async () => {
    await expect(lockRefundableOrder(tx, order.id)).resolves.toEqual(order);
    expect(calls).toEqual(['lock', 'read']);
  });

  it('rejects a missing order after locking its key', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(lockRefundableOrder(tx, order.id)).rejects.toThrowError(
      '订单不存在',
    );
  });

  it('projects a partial refund from the latest accumulated totals', async () => {
    const updated = {
      ...order,
      refund_amount_cents: 700,
      product_refund_amount_cents: 600,
      delivery_refund_amount_cents: 100,
    };
    update.mockResolvedValue(updated);

    await expect(projectRefundSuccess(tx, {
      order,
      refund: refund as any,
    })).resolves.toEqual({
      order: updated,
      is_full_refund: false,
      remaining_refundable_amount_cents: 300,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: {
        refund_amount_cents: 700,
        product_refund_amount_cents: 600,
        delivery_refund_amount_cents: 100,
        refund_status: 'success',
        order_status: 'paid',
      },
    });
  });

  it('projects cumulative full refund as refunded', async () => {
    const full = {
      ...refund,
      refund_amount_cents: 700,
      product_refund_amount_cents: 500,
      delivery_refund_amount_cents: 200,
    };
    const updated = {
      ...order,
      refund_amount_cents: 1000,
      product_refund_amount_cents: 800,
      delivery_refund_amount_cents: 200,
      order_status: 'refunded',
    };
    update.mockResolvedValue(updated);

    await expect(projectRefundSuccess(tx, {
      order,
      refund: full as any,
    })).resolves.toEqual({
      order: updated,
      is_full_refund: true,
      remaining_refundable_amount_cents: 0,
    });
  });

  it('rejects a refund beyond the latest total balance', async () => {
    await expect(projectRefundSuccess(tx, {
      order,
      refund: { ...refund, refund_amount_cents: 701 } as any,
    })).rejects.toThrowError('退款金额超过订单实付金额');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects projecting a refund onto an unpaid order', async () => {
    await expect(projectRefundSuccess(tx, {
      order: { ...order, pay_status: 'unpaid', order_status: 'unpaid' },
      refund: refund as any,
    })).rejects.toThrowError('未支付订单不能退款');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a product split beyond the latest product balance', async () => {
    await expect(projectRefundSuccess(tx, {
      order,
      refund: {
        ...refund,
        refund_amount_cents: 600,
        product_refund_amount_cents: 501,
        delivery_refund_amount_cents: 99,
      } as any,
    })).rejects.toThrowError('商品退款金额超过商品可退金额');
  });

  it('rejects an explicit stale order version', async () => {
    await expect(projectRefundSuccess(tx, {
      order,
      refund: refund as any,
      expected_order_version: 3,
    })).rejects.toBeInstanceOf(RefundOrderVersionConflictError);
  });

  it('uses compare-and-set and increments an expected order version', async () => {
    const updated = { ...order, version: 5, refund_amount_cents: 700 };
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValueOnce(updated);

    await expect(projectRefundSuccess(tx, {
      order,
      refund: refund as any,
      expected_order_version: 4,
    })).resolves.toEqual({
      order: updated,
      is_full_refund: false,
      remaining_refundable_amount_cents: 300,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: order.id,
        version: 4,
        refund_amount_cents: 300,
        product_refund_amount_cents: 300,
        delivery_refund_amount_cents: 0,
      },
      data: {
        refund_amount_cents: 700,
        product_refund_amount_cents: 600,
        delivery_refund_amount_cents: 100,
        refund_status: 'success',
        order_status: 'paid',
        version: { increment: 1 },
      },
    });
  });

  it('maps a lost compare-and-set to the version conflict', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(projectRefundSuccess(tx, {
      order,
      refund: refund as any,
      expected_order_version: 4,
    })).rejects.toBeInstanceOf(RefundOrderVersionConflictError);
  });

  it('records strict refund success event and timeline', async () => {
    createBusinessEvent.mockResolvedValue({ id: 'event-1' });
    createTimeline.mockResolvedValue({ id: 'timeline-1' });

    await recordRefundOrderEffects(tx, {
      before_order: order as any,
      projected_order: { ...order, refund_amount_cents: 700 } as any,
      refund: refund as any,
      is_full_refund: false,
    });

    expect(createBusinessEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'refund_success',
        event_source: 'order-refund-service',
        order_id: order.id,
        refund_id: refund.id,
      }),
    });
    expect(createTimeline).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order_id: order.id,
        event_type: 'refund_success',
        title: '订单已部分退款',
      }),
    });
  });
});
