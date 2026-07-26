import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimOrderPayment,
  markGroupPaidOrdersGrouped,
  recordPaidOrderEffects,
  setPaidOrderStatus,
} from './order-payment-service.js';

const updateMany = vi.fn();
const findUnique = vi.fn();
const findUniqueOrThrow = vi.fn();
const update = vi.fn();
const createBusinessEvent = vi.fn();
const createTimeline = vi.fn();
const tx = {
  order: {
    updateMany,
    findUnique,
    findUniqueOrThrow,
    update,
  },
  businessEventLog: {
    create: createBusinessEvent,
  },
  orderTimelineLog: {
    create: createTimeline,
  },
} as any;

const order = {
  id: 'order-1',
  version: 1,
  order_no: 'O1',
  client_request_id: 'request-1',
  user_id: 'user-1',
  group_buy_id: null,
  product_id: 'product-1',
  leader_user_id: null,
  total_amount_cents: 1200,
  product_amount_cents: 1200,
  delivery_fee_cents: 0,
  delivery_time_window_code: null,
  delivery_time_window_text: null,
  pay_amount_cents: 1200,
  quantity: 1,
  refund_amount_cents: 0,
  product_refund_amount_cents: 0,
  delivery_refund_amount_cents: 0,
  credit_amount_cents: 0,
  credit_source_type: null,
  credit_source_id: null,
  pay_status: 'unpaid',
  order_status: 'unpaid',
  refund_status: 'none',
  pickup_type: 'store',
  pickup_store_id: 'store-1',
  community_id: 'community-1',
  receiver_name: '测试用户',
  receiver_phone: '13800000000',
  receiver_address: null,
  created_at: new Date('2026-07-25T00:00:00.000Z'),
  paid_at: null,
  completed_at: null,
  updated_at: new Date('2026-07-25T00:00:00.000Z'),
};

beforeEach(() => {
  updateMany.mockReset();
  findUnique.mockReset();
  findUniqueOrThrow.mockReset();
  update.mockReset();
  createBusinessEvent.mockReset();
  createTimeline.mockReset();
});

describe('order payment owner', () => {
  it('claims an unpaid order with the supplied paid timestamp', async () => {
    const paidAt = new Date('2026-07-25T01:00:00.000Z');
    const claimedOrder = {
      ...order,
      pay_status: 'paid',
      paid_at: paidAt,
    };
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue(claimedOrder);

    await expect(
      claimOrderPayment(tx, order.id, paidAt),
    ).resolves.toEqual({ claimed: true, order: claimedOrder });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: order.id, pay_status: 'unpaid' },
      data: { pay_status: 'paid', paid_at: paidAt },
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: order.id },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns the latest order when another request already claimed payment', async () => {
    const latest = {
      ...order,
      pay_status: 'paid',
      order_status: 'paid',
    };
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(latest);

    await expect(
      claimOrderPayment(tx, order.id, new Date()),
    ).resolves.toEqual({ claimed: false, order: latest });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: order.id } });
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rejects a missing order after a failed conditional claim', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(null);

    await expect(
      claimOrderPayment(tx, order.id, new Date()),
    ).rejects.toThrowError('订单不存在');
  });

  it.each(['paid', 'grouped'] as const)(
    'sets the paid order status to %s',
    async (status) => {
      const updated = { ...order, pay_status: 'paid', order_status: status };
      update.mockResolvedValue(updated);

      await expect(
        setPaidOrderStatus(tx, order.id, status),
      ).resolves.toEqual(updated);

      expect(update).toHaveBeenCalledWith({
        where: { id: order.id },
        data: { order_status: status },
      });
    },
  );

  it('groups only valid paid orders in the target group', async () => {
    updateMany.mockResolvedValue({ count: 3 });

    await expect(
      markGroupPaidOrdersGrouped(tx, 'group-1'),
    ).resolves.toBe(3);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        group_buy_id: 'group-1',
        pay_status: 'paid',
        order_status: { notIn: ['closed', 'refunded'] },
        refund_status: { notIn: ['success'] },
      },
      data: { order_status: 'grouped' },
    });
  });

  it('records the existing paid event and timeline through the Order owner', async () => {
    const paidOrder = {
      ...order,
      pay_status: 'paid',
      order_status: 'grouped',
    };
    createBusinessEvent.mockResolvedValue({ id: 'event-1' });
    createTimeline.mockResolvedValue({ id: 'timeline-1' });

    await recordPaidOrderEffects(tx, {
      beforeOrder: order as any,
      paidOrder: paidOrder as any,
      paymentId: 'payment-1',
      transactionId: 'wechat-1',
      groupBuyId: 'group-1',
      groupStatus: 'success',
    });

    expect(createBusinessEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'payment_mark_order_paid',
        event_source: 'order-payment-service',
        order_id: 'order-1',
        group_buy_id: 'group-1',
        payment_id: 'payment-1',
        payload: {
          transaction_id: 'wechat-1',
          group_status: 'success',
        },
      }),
    });
    expect(createTimeline).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order_id: 'order-1',
        event_type: 'payment_mark_order_paid',
        title: '订单已支付',
        from_status: 'unpaid',
        to_status: 'grouped',
        actor_type: 'system',
        payload: { payment_id: 'payment-1' },
      }),
    });
  });
});
